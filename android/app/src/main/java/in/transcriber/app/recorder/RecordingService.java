package in.transcriber.app.recorder;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioFormat;
import android.media.AudioRecord;
import android.media.MediaRecorder;
import android.net.ConnectivityManager;
import android.net.Network;
import android.net.Uri;
import android.net.wifi.WifiManager;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import android.os.SystemClock;
import android.util.Log;
import android.webkit.CookieManager;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.File;
import java.io.IOException;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executors;
import java.util.concurrent.ScheduledExecutorService;
import java.util.concurrent.ScheduledFuture;
import java.util.concurrent.TimeUnit;

import in.transcriber.app.MainActivity;
import okhttp3.Call;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.RequestBody;
import okhttp3.Response;
import okhttp3.WebSocket;
import okhttp3.WebSocketListener;
import okio.ByteString;

/**
 * Records a meeting in a foreground service, so it keeps going with the screen off or while
 * another app is open, for as long as the meeting lasts.
 *
 * Mirrors the web recorder's cloud mode (src/hooks/useRecorder.ts): 16 kHz mono PCM streamed to
 * Deepgram with speaker labels, the same transcript format, and the same incremental autosave to
 * PATCH /api/meetings/:id. It runs on its own, without the web page: the page only reads its state
 * (MeetingRecorderPlugin.getState) to show it.
 *
 * Threads: "capture" reads the mic into the backlog; "sender" streams the backlog to Deepgram;
 * "ctl" (single thread) does connecting, saving and stopping, so those never race each other.
 */
public class RecordingService extends Service {
    private static final String TAG = "RecordingService";

    public static final String ACTION_START = "in.transcriber.app.recorder.START";
    public static final String ACTION_STOP = "in.transcriber.app.recorder.STOP";
    public static final String ACTION_FORCE_STOP = "in.transcriber.app.recorder.FORCE_STOP";
    public static final String ACTION_PAUSE = "in.transcriber.app.recorder.PAUSE";
    public static final String ACTION_RESUME = "in.transcriber.app.recorder.RESUME";
    public static final String EXTRA_MEETING_ID = "meetingId";
    public static final String EXTRA_LANGUAGE = "language";
    public static final String EXTRA_BASE_URL = "baseUrl";

    static final int SAMPLE_RATE = 16000;
    static final int BYTES_PER_SECOND = SAMPLE_RATE * 2;

    private static final int NOTIFICATION_ID = 1001;
    private static final String CHANNEL_ID = "recording";
    private static final long AUTOSAVE_MS = 5000;
    private static final long KEEPALIVE_MS = 5000;
    private static final long RECONNECT_MAX_DELAY_MS = 30_000;
    /** How long to wait for Deepgram's last words after asking it to finish. */
    private static final long FINALIZE_TIMEOUT_MS = 4000;
    /** A speaker's bubble is closed after this many characters even without a pause. */
    private static final int MAX_BUBBLE_CHARS = 400;
    private static final double NO_SOUND_RMS = 0.0004;
    private static final long NO_SOUND_MS = 5000;
    private static final MediaType JSON = MediaType.get("application/json; charset=utf-8");

    // ---- State shared with the plugin (guarded by LOCK) --------------------------------------
    static final Object LOCK = new Object();
    static final ArrayList<Part> parts = new ArrayList<>();
    static String meetingId;
    static String status = "Ready";
    static String saveState = "idle";
    static String interim = "";
    /** The service is running (recording or finishing). */
    static volatile boolean active;
    static volatile boolean paused;
    /** Stop was tapped; the last audio is still being sent or saved. */
    static volatile boolean finishing;
    /** The last meeting is over and saved (or the final save failed: see saveState). */
    static volatile boolean finished;
    static boolean noSound;
    /** The server said this meeting was stopped from another device (Meetings list). */
    static volatile boolean stoppedRemotely;
    static boolean online = true;
    static double backlogSeconds;
    static volatile float level;
    /** Samples recorded so far, pauses excluded: the meeting clock. */
    static volatile long recordedSamples;

    static final class Part {
        final int speaker;
        final String text;
        final double t;

        Part(int speaker, String text, double t) {
            this.speaker = speaker;
            this.text = text;
            this.t = t;
        }

        JSONObject toJson() throws JSONException {
            return new JSONObject().put("speaker", speaker).put("text", text).put("t", t);
        }
    }

    /** One Deepgram WebSocket. Deepgram's word times restart at 0 for each one. */
    private static final class Conn {
        WebSocket ws;
        volatile boolean opened;
        /** Set by the sender before any audio goes out on this socket. */
        volatile boolean ready;
        volatile boolean closed;
        volatile boolean finishSent;
        volatile double offsetSec;
    }

    // ---- Service internals ----------------------------------------------------------------
    private OkHttpClient http;
    private OkHttpClient wsClient;
    private ScheduledExecutorService ctl;
    private Thread captureThread;
    private Thread senderThread;
    private AudioBacklog backlog;
    private String baseUrl;
    private String language;
    private String currentMeetingId;

    private volatile boolean running;
    private volatile boolean capturing;
    private volatile boolean finishRequested;
    private volatile Conn current;
    /** Bytes taken out of the backlog so far (sender thread only): where the next socket starts. */
    private long bytesPolled;
    private int reconnectAttempt;
    private boolean connecting;
    private ScheduledFuture<?> reconnectTask;
    private ScheduledFuture<?> autosaveTask;
    private boolean completed;

    // Guarded by LOCK
    private boolean openBubble;
    private int savedParts;
    private boolean dirty;

    private PowerManager.WakeLock wakeLock;
    private WifiManager.WifiLock wifiLock;
    private ConnectivityManager.NetworkCallback networkCallback;

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        Log.i(TAG, "onStartCommand " + action + " running=" + running);
        if (ACTION_START.equals(action)) {
            if (running) return START_NOT_STICKY;
            String id = intent.getStringExtra(EXTRA_MEETING_ID);
            String base = intent.getStringExtra(EXTRA_BASE_URL);
            if (id == null || base == null) {
                stopSelf();
                return START_NOT_STICKY;
            }
            begin(id, intent.getStringExtra(EXTRA_LANGUAGE), base);
        } else if (ACTION_PAUSE.equals(action)) {
            setPaused(true);
        } else if (ACTION_RESUME.equals(action)) {
            setPaused(false);
        } else if (ACTION_STOP.equals(action)) {
            if (running) ctl.execute(() -> beginStop(false));
            else stopSelf();
        } else if (ACTION_FORCE_STOP.equals(action)) {
            if (running) ctl.execute(() -> beginStop(true));
            else stopSelf();
        } else if (!running) {
            // Restarted by the system after the process died: nothing to resume.
            stopSelf();
        }
        return START_NOT_STICKY;
    }

    // ---- Start --------------------------------------------------------------------------------
    private void begin(String id, @Nullable String lang, String base) {
        baseUrl = base.replaceAll("/+$", "");
        language = lang == null ? "en" : lang;
        currentMeetingId = id;
        synchronized (LOCK) {
            parts.clear();
            meetingId = id;
            status = "Connecting to Deepgram…";
            saveState = "idle";
            interim = "";
            active = true;
            paused = false;
            finishing = false;
            finished = false;
            noSound = false;
            stoppedRemotely = false;
            online = true;
            backlogSeconds = 0;
            openBubble = false;
            savedParts = 0;
            dirty = false;
        }
        level = 0;
        recordedSamples = 0;
        bytesPolled = 0;
        reconnectAttempt = 0;
        completed = false;
        finishRequested = false;

        // Android requires the notification within seconds of starting, and before using the mic.
        try {
            ServiceCompat.startForeground(this, NOTIFICATION_ID, buildNotification(),
                    Build.VERSION.SDK_INT >= Build.VERSION_CODES.R ? ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE : 0);
        } catch (Exception e) {
            Log.e(TAG, "startForeground failed", e);
            synchronized (LOCK) {
                active = false;
                finished = true;
                status = "Android blocked recording in the background. Open the app and try again.";
                saveState = "error";
            }
            stopSelf();
            return;
        }

        http = new OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(30, TimeUnit.SECONDS)
                .writeTimeout(30, TimeUnit.SECONDS)
                .build();
        wsClient = http.newBuilder()
                .readTimeout(0, TimeUnit.MILLISECONDS)
                .pingInterval(25, TimeUnit.SECONDS) // notices a dead connection (e.g. Wi-Fi gone) quickly
                .build();
        backlog = new AudioBacklog(new File(getCacheDir(), "recording-backlog.pcm"));
        ctl = Executors.newSingleThreadScheduledExecutor(r -> new Thread(r, "recorder-ctl"));

        acquireLocks();
        registerNetworkCallback();

        running = true;
        capturing = true;
        captureThread = new Thread(this::captureLoop, "recorder-capture");
        captureThread.setPriority(Thread.MAX_PRIORITY);
        captureThread.start();
        senderThread = new Thread(this::senderLoop, "recorder-sender");
        senderThread.start();

        ctl.execute(this::connect);
        autosaveTask = ctl.scheduleWithFixedDelay(() -> {
            refreshStatus();
            save(null);
        }, AUTOSAVE_MS, AUTOSAVE_MS, TimeUnit.MILLISECONDS);
    }

    private void acquireLocks() {
        PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
        // Keeps the CPU running with the screen off. Released when the meeting ends (24 h cap).
        wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "Transcriber:recording");
        wakeLock.setReferenceCounted(false);
        wakeLock.acquire(24L * 3600 * 1000);
        WifiManager wm = (WifiManager) getApplicationContext().getSystemService(Context.WIFI_SERVICE);
        if (wm != null) {
            int mode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q
                    ? WifiManager.WIFI_MODE_FULL_LOW_LATENCY
                    : WifiManager.WIFI_MODE_FULL_HIGH_PERF;
            wifiLock = wm.createWifiLock(mode, "Transcriber:recording");
            wifiLock.setReferenceCounted(false);
            wifiLock.acquire();
        }
    }

    private void registerNetworkCallback() {
        ConnectivityManager cm = (ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE);
        if (cm == null) return;
        networkCallback = new ConnectivityManager.NetworkCallback() {
            @Override
            public void onAvailable(Network network) {
                // Back online: reconnect now instead of waiting out the backoff.
                if (ctl == null) return;
                ctl.execute(() -> {
                    synchronized (LOCK) {
                        online = true;
                    }
                    if (running && current == null && !connecting) {
                        if (reconnectTask != null) reconnectTask.cancel(false);
                        reconnectAttempt = 0;
                        connect();
                    }
                });
            }

            @Override
            public void onLost(Network network) {
                synchronized (LOCK) {
                    online = false;
                }
            }
        };
        try {
            cm.registerDefaultNetworkCallback(networkCallback);
        } catch (Exception e) {
            networkCallback = null;
        }
    }

    // ---- Microphone -----------------------------------------------------------------------------
    private void captureLoop() {
        int minBuf = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT);
        short[] buf = new short[SAMPLE_RATE / 10]; // 100 ms
        AudioRecord rec = null;
        long quietSince = -1;
        while (capturing) {
            if (rec == null) {
                try {
                    //noinspection MissingPermission (checked by the plugin before starting)
                    rec = new AudioRecord(MediaRecorder.AudioSource.MIC, SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO,
                            AudioFormat.ENCODING_PCM_16BIT, Math.max(minBuf, BYTES_PER_SECOND));
                    if (rec.getState() != AudioRecord.STATE_INITIALIZED) throw new IllegalStateException("not initialized");
                    rec.startRecording();
                } catch (Exception e) {
                    Log.w(TAG, "Mic unavailable", e);
                    if (rec != null) rec.release();
                    rec = null;
                    setStatus("The microphone is busy (a call or another recorder?). Retrying…");
                    SystemClock.sleep(1000);
                    continue;
                }
            }
            int n = rec.read(buf, 0, buf.length);
            if (n <= 0) {
                // Mic taken away (call, another app) or an audio server restart: reopen it.
                try {
                    rec.stop();
                } catch (Exception ignored) {
                }
                rec.release();
                rec = null;
                SystemClock.sleep(300);
                continue;
            }
            if (paused) {
                level = 0;
                quietSince = -1;
                continue;
            }
            double sum = 0;
            byte[] bytes = new byte[n * 2];
            for (int i = 0; i < n; i++) {
                short s = buf[i];
                sum += (double) s * s;
                bytes[2 * i] = (byte) (s & 0xff);
                bytes[2 * i + 1] = (byte) ((s >> 8) & 0xff);
            }
            double rms = Math.sqrt(sum / n) / 32768.0;
            level = rms <= 0 ? 0 : (float) Math.max(0, Math.min(1, (20 * Math.log10(rms) + 60) / 60));
            long now = SystemClock.elapsedRealtime();
            if (rms < NO_SOUND_RMS) {
                if (quietSince < 0) quietSince = now;
            } else {
                quietSince = -1;
            }
            boolean quiet = quietSince >= 0 && now - quietSince > NO_SOUND_MS;
            synchronized (LOCK) {
                noSound = quiet;
            }
            backlog.add(bytes);
            recordedSamples += n;
        }
        if (rec != null) {
            try {
                rec.stop();
            } catch (Exception ignored) {
            }
            rec.release();
        }
        level = 0;
    }

    // ---- Sending audio ------------------------------------------------------------------------
    private void senderLoop() {
        long lastSentAt = SystemClock.elapsedRealtime();
        while (running) {
            Conn c = current;
            if (c == null || !c.opened || c.closed || c.finishSent) {
                SystemClock.sleep(100);
                continue;
            }
            if (!c.ready) {
                // First audio on this socket: map Deepgram's times (from 0) onto the meeting clock.
                c.offsetSec = bytesPolled / (double) BYTES_PER_SECOND;
                synchronized (LOCK) {
                    openBubble = false;
                }
                c.ready = true;
            }
            if (c.ws.queueSize() > 256 * 1024) {
                // Catching up after being offline: don't outrun the connection (OkHttp drops it at 16 MB).
                SystemClock.sleep(50);
                continue;
            }
            byte[] chunk = backlog.poll(16 * 1024, 200);
            long now = SystemClock.elapsedRealtime();
            if (chunk == null) {
                if (finishRequested) {
                    // Everything recorded has been sent: ask for the last words, then close.
                    c.finishSent = true;
                    c.ws.send("{\"type\":\"Finalize\"}");
                    c.ws.send("{\"type\":\"CloseStream\"}");
                    continue;
                }
                if (now - lastSentAt > KEEPALIVE_MS) {
                    // Paused: Deepgram closes sockets that get no audio for ~10 s.
                    c.ws.send("{\"type\":\"KeepAlive\"}");
                    lastSentAt = now;
                }
                continue;
            }
            if (c.ws.send(ByteString.of(chunk))) {
                bytesPolled += chunk.length;
                lastSentAt = now;
            } else {
                backlog.unread(chunk); // socket is closing: keep it for the next one
                SystemClock.sleep(100);
            }
        }
    }

    // ---- Deepgram connection (ctl thread) -------------------------------------------------------
    private void connect() {
        if (!running || connecting || current != null) return;
        connecting = true;
        try {
            String token = fetchToken();
            Request req = new Request.Builder()
                    .url(deepgramUrl(language))
                    .header("Authorization", "Bearer " + token)
                    .build();
            Conn c = new Conn();
            current = c;
            c.ws = wsClient.newWebSocket(req, new Listener(c));
        } catch (AuthException e) {
            setStatus("You've been signed out. Open the app and sign in again — audio is kept meanwhile.");
            scheduleReconnect();
        } catch (Exception e) {
            Log.w(TAG, "Connect failed", e);
            scheduleReconnect();
        } finally {
            connecting = false;
        }
    }

    private void scheduleReconnect() {
        if (!running || current != null) return;
        if (finishRequested && backlog.isEmpty()) {
            completeStop();
            return;
        }
        long delay = Math.min(RECONNECT_MAX_DELAY_MS, 1000L << Math.min(reconnectAttempt, 5));
        reconnectAttempt++;
        refreshStatus();
        if (reconnectTask != null) reconnectTask.cancel(false);
        reconnectTask = ctl.schedule(this::connect, delay, TimeUnit.MILLISECONDS);
    }

    private void onConnLost(Conn c) {
        if (c != current) return;
        c.closed = true;
        current = null;
        if (!running) return;
        if (c.finishSent) {
            // Normal end after Stop (or Deepgram closed during the last words).
            if (backlog.isEmpty()) {
                completeStop();
                return;
            }
        }
        scheduleReconnect();
    }

    private final class Listener extends WebSocketListener {
        private final Conn c;

        Listener(Conn c) {
            this.c = c;
        }

        @Override
        public void onOpen(WebSocket webSocket, Response response) {
            c.opened = true;
            ctl.execute(() -> {
                reconnectAttempt = 0;
                refreshStatus();
            });
        }

        @Override
        public void onMessage(WebSocket webSocket, String text) {
            handleMessage(c, text);
        }

        @Override
        public void onClosing(WebSocket webSocket, int code, String reason) {
            webSocket.close(1000, null);
        }

        @Override
        public void onClosed(WebSocket webSocket, int code, String reason) {
            ctl.execute(() -> onConnLost(c));
        }

        @Override
        public void onFailure(WebSocket webSocket, Throwable t, @Nullable Response response) {
            Log.w(TAG, "Deepgram socket failed" + (response != null ? " (" + response.code() + ")" : ""), t);
            ctl.execute(() -> onConnLost(c));
        }
    }

    /** Same as appendDeepgram() in useRecorder.ts: one bubble per speaker turn, growing until a pause. */
    private void handleMessage(Conn c, String text) {
        JSONObject msg;
        try {
            msg = new JSONObject(text);
        } catch (JSONException e) {
            return;
        }
        String type = msg.optString("type");
        if ("UtteranceEnd".equals(type)) {
            synchronized (LOCK) {
                openBubble = false;
            }
            return;
        }
        JSONObject channel = msg.optJSONObject("channel");
        JSONArray alts = channel == null ? null : channel.optJSONArray("alternatives");
        JSONObject alt = alts == null ? null : alts.optJSONObject(0);
        if (alt == null) return;

        if (!msg.optBoolean("is_final")) {
            synchronized (LOCK) {
                interim = alt.optString("transcript", "");
            }
            return;
        }

        JSONArray words = alt.optJSONArray("words");
        synchronized (LOCK) {
            interim = "";
            if (words != null) {
                int i = 0;
                while (i < words.length()) {
                    // A run of consecutive words by the same speaker.
                    JSONObject first = words.optJSONObject(i);
                    if (first == null) {
                        i++;
                        continue;
                    }
                    int speaker = first.optInt("speaker", 0);
                    double start = first.optDouble("start", 0);
                    StringBuilder sb = new StringBuilder();
                    while (i < words.length()) {
                        JSONObject w = words.optJSONObject(i);
                        if (w == null) {
                            i++;
                            continue;
                        }
                        if (w.optInt("speaker", 0) != speaker) break;
                        String word = w.optString("punctuated_word", w.optString("word", ""));
                        if (sb.length() > 0) sb.append(' ');
                        sb.append(word);
                        i++;
                    }
                    String runText = sb.toString().trim();
                    if (runText.isEmpty()) continue;
                    Part last = parts.isEmpty() ? null : parts.get(parts.size() - 1);
                    if (openBubble && last != null && last.speaker == speaker && last.text.length() < MAX_BUBBLE_CHARS) {
                        parts.set(parts.size() - 1, new Part(last.speaker, last.text + " " + runText, last.t));
                    } else {
                        double t = Math.round((c.offsetSec + start) * 10) / 10.0;
                        parts.add(new Part(speaker, runText, t));
                    }
                    openBubble = true;
                    dirty = true;
                }
            }
            if (msg.optBoolean("speech_final")) openBubble = false;
        }
    }

    private static String deepgramUrl(String language) {
        Uri.Builder b = Uri.parse("wss://api.deepgram.com/v1/listen").buildUpon()
                .appendQueryParameter("model", "nova-3")
                // "multi" is Nova-3's code-switching mode (English and Hindi mixed in one sentence).
                .appendQueryParameter("language", "auto".equals(language) ? "multi" : language)
                .appendQueryParameter("encoding", "linear16")
                .appendQueryParameter("sample_rate", String.valueOf(SAMPLE_RATE))
                .appendQueryParameter("channels", "1")
                .appendQueryParameter("smart_format", "true")
                .appendQueryParameter("punctuate", "true")
                .appendQueryParameter("diarize", "true")
                .appendQueryParameter("interim_results", "true")
                .appendQueryParameter("endpointing", "300")
                .appendQueryParameter("utterance_end_ms", "1000");
        return b.build().toString();
    }

    // ---- Server calls (ctl thread) ------------------------------------------------------------
    private static final class AuthException extends IOException {
    }

    private Request.Builder serverRequest(String path) {
        Request.Builder b = new Request.Builder().url(baseUrl + path);
        // The app's sign-in cookie lives in the WebView's cookie store.
        try {
            String cookie = CookieManager.getInstance().getCookie(baseUrl);
            if (cookie != null) b.header("Cookie", cookie);
        } catch (Exception ignored) {
        }
        return b;
    }

    private String fetchToken() throws IOException {
        Request req = serverRequest("/api/deepgram/token").post(RequestBody.create("{}", JSON)).build();
        try (Response res = http.newCall(req).execute()) {
            if (res.code() == 401) throw new AuthException();
            String body = res.body() == null ? "" : res.body().string();
            if (!res.isSuccessful()) throw new IOException("token " + res.code() + " " + body);
            try {
                return new JSONObject(body).getString("token");
            } catch (JSONException e) {
                throw new IOException("bad token response");
            }
        }
    }

    /** Same as save() in useRecorder.ts: sends only what changed since the last confirmed save. */
    private boolean save(@Nullable String finalStatus) {
        if (currentMeetingId == null) return true;
        for (int attempt = 0; attempt < 2; attempt++) {
            int from;
            List<Part> tail;
            synchronized (LOCK) {
                if (!dirty && finalStatus == null) return true;
                dirty = false;
                from = Math.max(0, Math.min(savedParts - 1, parts.size()));
                tail = new ArrayList<>(parts.subList(from, parts.size()));
                saveState = "saving";
            }
            int sent = from + tail.size();
            try {
                JSONArray arr = new JSONArray();
                for (Part p : tail) arr.put(p.toJson());
                JSONObject body = new JSONObject()
                        .put("transcriptTail", new JSONObject().put("from", from).put("parts", arr))
                        .put("durationSec", recordedSamples / SAMPLE_RATE);
                if (finalStatus != null) body.put("status", finalStatus);
                Request req = serverRequest("/api/meetings/" + currentMeetingId)
                        .patch(RequestBody.create(body.toString(), JSON))
                        .build();
                Call call = http.newCall(req);
                try (Response res = call.execute()) {
                    String text = res.body() == null ? "" : res.body().string();
                    JSONObject data;
                    try {
                        data = new JSONObject(text);
                    } catch (JSONException e) {
                        data = new JSONObject();
                    }
                    if (res.code() == 409 && data.has("savedParts")) {
                        // The server has less than we thought (a save got lost): resend from there.
                        synchronized (LOCK) {
                            savedParts = data.optInt("savedParts", 0);
                            dirty = true;
                        }
                        continue;
                    }
                    if (!res.isSuccessful()) throw new IOException("save " + res.code());
                    synchronized (LOCK) {
                        savedParts = data.optInt("savedParts", sent);
                        saveState = "saved";
                    }
                    // Stopped from the Meetings list on another device: the tail was merged, now finish normally.
                    if (finalStatus == null && !finishRequested && !completed
                            && (data.optBoolean("stopped", false) || "DONE".equals(data.optString("status")))) {
                        stoppedRemotely = true;
                        Log.i(TAG, "Meeting was stopped from another device");
                        setStatus("Stopped from another device. Saving…");
                        ctl.execute(() -> beginStop(false));
                    }
                    return true;
                }
            } catch (Exception e) {
                Log.w(TAG, "Save failed", e);
                break;
            }
        }
        synchronized (LOCK) {
            dirty = true; // retry on the next tick
            saveState = "error";
        }
        return false;
    }

    // ---- Pause / stop -----------------------------------------------------------------------------
    private void setPaused(boolean p) {
        if (!running || finishRequested) return;
        synchronized (LOCK) {
            paused = p;
            interim = "";
        }
        Conn c = current;
        // Get the words heard so far now, instead of after the break.
        if (p && c != null && c.ready) c.ws.send("{\"type\":\"Finalize\"}");
        refreshStatus();
    }

    /**
     * Stop: the mic closes at once, then every recorded second still waiting (e.g. from a time
     * offline) is sent before the meeting is closed. Force stop skips what hasn't been sent.
     */
    private void beginStop(boolean force) {
        Log.i(TAG, "beginStop force=" + force);
        if (!running || completed) return;
        if (force) backlog.clear();
        capturing = false;
        finishRequested = true;
        synchronized (LOCK) {
            finishing = true;
            paused = false;
            interim = "";
        }
        refreshStatus();
        Conn c = current;
        if (force || c == null || !c.opened) {
            if (backlog.isEmpty() || force) {
                if (c != null) c.ws.cancel();
                completeStop();
                return;
            }
        }
        ctl.schedule(this::watchFinish, 500, TimeUnit.MILLISECONDS);
    }

    /** While finishing: keeps the status current, and gives up waiting for Deepgram after a while. */
    private void watchFinish() {
        if (completed) return;
        Conn c = current;
        if (c != null && c.finishSent) {
            ctl.schedule(() -> {
                if (completed) return;
                Conn now = current;
                if (now == c && backlog.isEmpty()) {
                    c.ws.cancel(); // Deepgram didn't close in time; we have what it sent
                    current = null;
                    completeStop();
                } else {
                    watchFinish(); // reconnected to send the rest: keep watching
                }
            }, FINALIZE_TIMEOUT_MS, TimeUnit.MILLISECONDS);
            return;
        }
        refreshStatus();
        ctl.schedule(this::watchFinish, 500, TimeUnit.MILLISECONDS);
    }

    private void completeStop() {
        if (completed) return;
        Log.i(TAG, "completeStop seconds=" + (recordedSamples / SAMPLE_RATE));
        completed = true;
        running = false;
        capturing = false;
        if (autosaveTask != null) autosaveTask.cancel(false);
        if (reconnectTask != null) reconnectTask.cancel(false);
        Conn c = current;
        if (c != null) c.ws.cancel();
        current = null;
        setStatus("Saving…");

        boolean ok = false;
        for (int attempt = 0; attempt < 5 && !ok; attempt++) {
            if (attempt > 0) SystemClock.sleep(1000L << attempt);
            ok = save("DONE");
        }
        double dropped = backlog.droppedSeconds();
        backlog.close();
        synchronized (LOCK) {
            active = false;
            finishing = false;
            finished = true;
            paused = false;
            interim = "";
            backlogSeconds = 0;
            saveState = ok ? "saved" : "error";
            status = ok && stoppedRemotely
                    ? "Stopped from another device. Meeting saved"
                    : ok
                    ? (dropped > 1 ? String.format(Locale.US, "Saved. %d min recorded offline could not be kept.", Math.round(dropped / 60)) : "Meeting saved")
                    : "Couldn't save the end of the meeting. Check the connection; the transcript up to the last autosave is safe.";
        }
        shutdown();
    }

    private void shutdown() {
        releaseLocks();
        if (networkCallback != null) {
            try {
                ((ConnectivityManager) getSystemService(Context.CONNECTIVITY_SERVICE)).unregisterNetworkCallback(networkCallback);
            } catch (Exception ignored) {
            }
            networkCallback = null;
        }
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
        if (ctl != null) ctl.shutdown();
    }

    private void releaseLocks() {
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        if (wifiLock != null && wifiLock.isHeld()) wifiLock.release();
    }

    @Override
    public void onDestroy() {
        if (running && !completed) {
            // Killed by the system: the transcript up to the last autosave is on the server.
            running = false;
            capturing = false;
            Conn c = current;
            if (c != null) c.ws.cancel();
            synchronized (LOCK) {
                active = false;
                finishing = false;
                finished = true;
                status = "Recording was stopped by Android. The transcript up to the last autosave is saved.";
            }
            releaseLocks();
            if (ctl != null) ctl.shutdownNow();
        }
        super.onDestroy();
    }

    // ---- Status & notification ------------------------------------------------------------------
    private void setStatus(String s) {
        synchronized (LOCK) {
            status = s;
        }
        updateNotification();
    }

    /** Works out the status line from the current situation. */
    private void refreshStatus() {
        double waiting = backlog == null ? 0 : backlog.seconds();
        Conn c = current;
        boolean connected = c != null && c.opened && !c.closed;
        String s;
        synchronized (LOCK) {
            backlogSeconds = waiting;
            if (finishing) {
                s = waiting > 5
                        ? (connected ? "Finishing: sending the last " + describe(waiting) + "…"
                                     : "Finishing: waiting for the internet to send the last " + describe(waiting) + ". Tap Stop again to finish without it.")
                        : "Finishing…";
            } else if (paused) {
                s = "Paused";
            } else if (!connected) {
                s = reconnectAttempt == 0 ? "Connecting to Deepgram…"
                        : "No connection — still recording. " + describe(waiting) + " will be transcribed when it's back.";
            } else if (waiting > 5) {
                s = "Back online — catching up (" + describe(waiting) + " to go)…";
            } else {
                s = "Recording (cloud, speaker labels)…";
            }
            status = s;
        }
        updateNotification();
    }

    private static String describe(double seconds) {
        if (seconds < 60) return Math.round(seconds) + " s of audio";
        return Math.round(seconds / 60) + " min of audio";
    }

    private void updateNotification() {
        if (!active) return;
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(NOTIFICATION_ID, buildNotification());
    }

    private Notification buildNotification() {
        NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null && nm.getNotificationChannel(CHANNEL_ID) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_ID, "Recording", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Shown while a meeting is being recorded");
            ch.setShowBadge(false);
            nm.createNotificationChannel(ch);
        }
        int piFlags = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        Intent open = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 0, open, piFlags);

        boolean isPaused, isFinishing;
        String text;
        synchronized (LOCK) {
            isPaused = paused;
            isFinishing = finishing;
            text = status;
        }
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ID)
                .setSmallIcon(android.R.drawable.ic_btn_speak_now)
                .setContentTitle(isFinishing ? "Finishing the meeting" : isPaused ? "Meeting paused" : "Recording meeting")
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
                .setContentIntent(openPi)
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setForegroundServiceBehavior(NotificationCompat.FOREGROUND_SERVICE_IMMEDIATE);

        if (!isPaused && !isFinishing) {
            // The system ticks the timer itself; no updates needed.
            long elapsedMs = recordedSamples * 1000 / SAMPLE_RATE;
            b.setUsesChronometer(true).setShowWhen(true).setWhen(System.currentTimeMillis() - elapsedMs);
        } else {
            b.setShowWhen(false);
        }
        if (!isFinishing) {
            Intent toggle = new Intent(this, RecordingService.class).setAction(isPaused ? ACTION_RESUME : ACTION_PAUSE);
            b.addAction(0, isPaused ? "Resume" : "Pause", PendingIntent.getService(this, 1, toggle, piFlags));
        }
        Intent stop = new Intent(this, RecordingService.class).setAction(isFinishing ? ACTION_FORCE_STOP : ACTION_STOP);
        b.addAction(0, isFinishing ? "Finish now" : "Stop", PendingIntent.getService(this, 2, stop, piFlags));
        return b.build();
    }
}
