package in.transcriber.app.recorder;

import android.content.Context;
import android.os.SystemClock;
import android.util.Log;

import androidx.annotation.Nullable;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.io.BufferedOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.RandomAccessFile;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Local (offline) capture storage: 16 kHz mono s16le PCM in fixed 5-minute segment files under
 * getNoBackupFilesDir()/offline-rec/<meetingId>/, plus meta.json. Sample indexes are absolute
 * (sample 0 = start of the meeting, pauses excluded).
 *
 * One instance writes (the capture thread calls append/markBreak, the service finishes it); any
 * instance, including one loaded cold from disk after a process kill, can read, release and
 * describe the files. Plugin calls arrive on Capacitor's own thread, so everything that touches
 * shared state is synchronized and the published head is volatile (set only after a flush).
 */
final class LocalCapture {
    private static final String TAG = "LocalCapture";

    static final int SAMPLE_RATE = 16000;
    /** 5 minutes = 4,800,000 samples = 9.6 MB per segment. */
    static final long SEGMENT_SAMPLES = 16000L * 300;
    static final int MAX_READ_SAMPLES = 30 * SAMPLE_RATE;

    /** Refuse to start below this much free space. */
    static final long REFUSE_BELOW_BYTES = 150L * 1024 * 1024;
    /** Warn when there is less than an hour of audio left. */
    static final long WARN_BELOW_BYTES = 3600L * SAMPLE_RATE * 2;
    /** Stop capture cleanly below this. */
    static final long STOP_BELOW_BYTES = 50L * 1024 * 1024;

    private static final Pattern ID = Pattern.compile("^[A-Za-z0-9_-]{1,64}$");
    private static final long FLUSH_MS = 1000;
    private static final long SYNC_MS = 5000;
    private static final long META_MS = 30000;

    /** The capture most recently opened in this process (kept after it finishes, so state can be read). */
    static volatile LocalCapture current;

    final String meetingId;
    private final File dir;
    private final Object lock = new Object();

    private String engine = "";
    private String language = "en";
    private long startedAt;
    private String state = "recording";
    @Nullable private String stoppedReason;
    private final List<Long> breaks = new ArrayList<>();
    private long committed;

    /** Samples flushed to disk: what readers may read. */
    private volatile long head;
    // Writer state (guarded by lock)
    private long writePos;
    private long segStart = -1;
    private BufferedOutputStream out;
    private FileOutputStream fos;
    private boolean writing;
    private boolean closed;
    private long lastFlush;
    private long lastSync;
    private long lastMeta;

    private LocalCapture(File dir, String meetingId) {
        this.dir = dir;
        this.meetingId = meetingId;
    }

    // ---- Paths & validation ---------------------------------------------------------------------
    static boolean validId(@Nullable String id) {
        return id != null && ID.matcher(id).matches();
    }

    static File root(Context ctx) {
        return new File(ctx.getNoBackupFilesDir(), "offline-rec");
    }

    /** The folder for a meeting, or null when the id is invalid or would escape the root. */
    @Nullable
    static File dirFor(Context ctx, @Nullable String id) {
        if (!validId(id)) return null;
        try {
            File root = root(ctx);
            File d = new File(root, id);
            String rootPath = root.getCanonicalPath();
            String dPath = d.getCanonicalPath();
            if (!dPath.startsWith(rootPath + File.separator)) return null;
            return d;
        } catch (IOException e) {
            return null;
        }
    }

    static long freeBytes(Context ctx) {
        File root = root(ctx);
        File probe = root.exists() ? root : ctx.getNoBackupFilesDir();
        return probe.getUsableSpace();
    }

    // ---- Open (writer) / load (cold) -------------------------------------------------------------
    /** Starts (or, if the folder already holds audio for this meeting, continues) a capture. */
    static LocalCapture open(Context ctx, String meetingId, String engine, String language) throws IOException {
        File d = dirFor(ctx, meetingId);
        if (d == null) throw new IOException("bad meeting id");
        if (!d.exists() && !d.mkdirs()) throw new IOException("cannot create " + d);
        LocalCapture c = new LocalCapture(d, meetingId);
        c.readMeta();
        c.engine = engine == null ? c.engine : engine;
        c.language = language == null ? c.language : language;
        if (c.startedAt == 0) c.startedAt = System.currentTimeMillis();
        c.head = c.scanHead();
        c.writePos = c.head;
        // A restart of the same meeting: the audio is contiguous in the files, so mark the gap.
        if (c.writePos > 0 && (c.breaks.isEmpty() || c.breaks.get(c.breaks.size() - 1) != c.writePos)) c.breaks.add(c.writePos);
        c.state = "recording";
        c.stoppedReason = null;
        c.writing = true;
        c.lastFlush = c.lastSync = c.lastMeta = SystemClock.elapsedRealtime();
        c.writeMeta();
        current = c;
        return c;
    }

    /** Describes an existing folder (no writing). Returns the live instance if this meeting is being captured. */
    @Nullable
    static LocalCapture load(Context ctx, String meetingId) {
        LocalCapture cur = current;
        if (cur != null && cur.meetingId.equals(meetingId) && cur.writing) return cur;
        File d = dirFor(ctx, meetingId);
        if (d == null || !d.isDirectory()) return null;
        LocalCapture c = new LocalCapture(d, meetingId);
        c.readMeta();
        c.head = c.scanHead();
        // A "recording" folder with no live writer means the process died: it was interrupted.
        if ("recording".equals(c.state)) {
            c.state = "interrupted";
        }
        return c;
    }

    static List<LocalCapture> listAll(Context ctx) {
        List<LocalCapture> out = new ArrayList<>();
        File[] dirs = root(ctx).listFiles();
        if (dirs == null) return out;
        for (File f : dirs) {
            if (!f.isDirectory()) continue;
            LocalCapture c = load(ctx, f.getName());
            if (c != null) out.add(c);
        }
        return out;
    }

    // ---- Writer API (capture thread) ---------------------------------------------------------------
    /** Appends little-endian s16 bytes. Throws when the disk refuses (full): the caller stops capture. */
    void append(byte[] bytes) throws IOException {
        synchronized (lock) {
            if (closed || !writing) return;
            int samples = bytes.length / 2;
            int done = 0;
            while (done < samples) {
                long segBase = (writePos / SEGMENT_SAMPLES) * SEGMENT_SAMPLES;
                if (out == null || segStart != segBase) openSegment(segBase);
                long room = segBase + SEGMENT_SAMPLES - writePos;
                int n = (int) Math.min(room, samples - done);
                out.write(bytes, done * 2, n * 2);
                writePos += n;
                done += n;
                if (writePos == segBase + SEGMENT_SAMPLES) {
                    flushAndSync(true);
                    closeSegment();
                }
            }
            long now = SystemClock.elapsedRealtime();
            if (now - lastFlush >= FLUSH_MS) {
                flushAndSync(now - lastSync >= SYNC_MS);
            }
            if (now - lastMeta >= META_MS) writeMetaLocked();
        }
    }

    /** A pause began at the current write position. */
    void markBreak() {
        synchronized (lock) {
            if (closed || !writing) return;
            try {
                flushAndSync(true);
            } catch (IOException e) {
                Log.w(TAG, "flush at break failed", e);
            }
            if (writePos > 0 && (breaks.isEmpty() || breaks.get(breaks.size() - 1) != writePos)) breaks.add(writePos);
            writeMetaLocked();
        }
    }

    /** Remembered in meta.json when the capture ends (e.g. "storage"). */
    void setStoppedReason(String reason) {
        synchronized (lock) {
            stoppedReason = reason;
        }
    }

    /** Ends the capture: flushes everything, closes the files, and records why. Safe to call twice. */
    void finish(String finalState, @Nullable String reason) {
        synchronized (lock) {
            if (closed) return;
            try {
                flushAndSync(true);
            } catch (IOException e) {
                Log.w(TAG, "final flush failed", e);
            }
            closeSegment();
            closed = true;
            writing = false;
            state = finalState;
            if (reason != null) stoppedReason = reason;
            writeMetaLocked();
        }
    }

    private void openSegment(long segBase) throws IOException {
        closeSegment();
        File f = segFile(segBase);
        if (f.length() % 2 != 0) {
            // A crash left half a sample at the end: drop it so new audio stays aligned.
            try (RandomAccessFile r = new RandomAccessFile(f, "rw")) {
                r.setLength(f.length() - 1);
            }
        }
        fos =new FileOutputStream(f, true); // append: continuing a partly written segment
        out = new BufferedOutputStream(fos, 64 * 1024);
        segStart = segBase;
    }

    private void closeSegment() {
        try {
            if (out != null) out.close();
        } catch (IOException e) {
            Log.w(TAG, "close segment failed", e);
        }
        out = null;
        fos = null;
        segStart = -1;
    }

    private void flushAndSync(boolean sync) throws IOException {
        if (out != null) {
            out.flush();
            if (sync && fos != null) {
                try {
                    fos.getFD().sync();
                } catch (IOException ignored) {
                }
                lastSync = SystemClock.elapsedRealtime();
            }
        }
        lastFlush = SystemClock.elapsedRealtime();
        head = writePos; // published only after the flush: readers never see unflushed bytes
    }

    // ---- Reader API (plugin thread) -----------------------------------------------------------------
    long head() {
        return head;
    }

    long committed() {
        synchronized (lock) {
            return committed;
        }
    }

    String state() {
        synchronized (lock) {
            return state;
        }
    }

    @Nullable
    String stoppedReason() {
        synchronized (lock) {
            return stoppedReason;
        }
    }

    boolean isWriting() {
        synchronized (lock) {
            return writing && !closed;
        }
    }

    /** Result of a read. */
    static final class Chunk {
        long from;
        int samples;
        byte[] data = new byte[0];
        long head;
        boolean ended;
        List<Long> breaks = new ArrayList<>();
    }

    /**
     * Reads flushed audio from `from`, at most one segment and `max` samples (clamped to 30 s).
     * Throws IOException("GONE") when that audio was already released.
     */
    Chunk read(long from, long max) throws IOException {
        // Decide "is the capture over" BEFORE reading the head: finish() publishes the final head and only
        // then flips the state, so an "over" seen first guarantees the head read next is the last one.
        // (The other order could report ended against a stale head and drop the last second of audio.)
        String st = state();
        boolean over = !"recording".equals(st) || !isWriting();
        long h = head;
        long first = firstAvailable();
        Chunk c = new Chunk();
        c.from = Math.max(0, from);
        c.head = h;
        if (c.from < first) throw new IOException("GONE");
        long limit = Math.max(0, Math.min(max, MAX_READ_SAMPLES));
        if (c.from >= h || limit == 0) {
            c.ended = over && c.from >= h;
            return c;
        }
        long segBase = (c.from / SEGMENT_SAMPLES) * SEGMENT_SAMPLES;
        long end = Math.min(h, Math.min(c.from + limit, segBase + SEGMENT_SAMPLES));
        int n = (int) (end - c.from);
        byte[] buf = new byte[n * 2];
        try (RandomAccessFile f = new RandomAccessFile(segFile(segBase), "r")) {
            f.seek((c.from - segBase) * 2);
            f.readFully(buf);
        }
        c.samples = n;
        c.data = buf;
        c.ended = over && c.from + n >= h;
        synchronized (lock) {
            for (long b : breaks) if (b >= c.from && b < c.from + n) c.breaks.add(b);
        }
        return c;
    }

    /** Deletes whole segments that end at or before `before` and remembers the committed cursor. Returns bytes freed. */
    long release(long before) {
        long freed = 0;
        synchronized (lock) {
            before = Math.min(before, head); // never claim audio that does not exist yet
            if (before > committed) committed = before;
            File[] files = dir.listFiles();
            if (files != null) {
                for (File f : files) {
                    long start = segStartOf(f.getName());
                    if (start < 0) continue;
                    if (start + SEGMENT_SAMPLES <= before && start != segStart) {
                        long len = f.length();
                        if (f.delete()) freed += len;
                    }
                }
            }
            writeMetaLocked();
        }
        return freed;
    }

    /** Deletes the whole folder. Refuses (false) while this capture is still writing. */
    boolean discard() {
        synchronized (lock) {
            if (writing && !closed) return false;
            closeSegment();
            File[] files = dir.listFiles();
            if (files != null) for (File f : files) f.delete();
            boolean ok = dir.delete();
            if (LocalCapture.current == this) LocalCapture.current = null;
            return ok || !dir.exists();
        }
    }

    JSONObject info(boolean active) throws JSONException {
        synchronized (lock) {
            return new JSONObject()
                    .put("meetingId", meetingId)
                    .put("head", head)
                    .put("committed", committed)
                    .put("state", state)
                    .put("stoppedReason", stoppedReason == null ? JSONObject.NULL : stoppedReason)
                    .put("startedAt", startedAt)
                    .put("engine", engine)
                    .put("language", language)
                    .put("active", active);
        }
    }

    // ---- Files & meta ---------------------------------------------------------------------------------
    private File segFile(long start) {
        return new File(dir, String.format(java.util.Locale.US, "seg-%010d.pcm", start));
    }

    private static long segStartOf(String name) {
        if (!name.startsWith("seg-") || !name.endsWith(".pcm")) return -1;
        try {
            return Long.parseLong(name.substring(4, name.length() - 4));
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /** The first sample still on disk (older segments were released). */
    private long firstAvailable() {
        long min = Long.MAX_VALUE;
        File[] files = dir.listFiles();
        if (files != null) {
            for (File f : files) {
                long s = segStartOf(f.getName());
                if (s >= 0 && s < min) min = s;
            }
        }
        return min == Long.MAX_VALUE ? head : min;
    }

    /** Head from the files: the last segment's start plus its whole samples (an odd byte is ignored). */
    private long scanHead() {
        long best = -1;
        long bestLen = 0;
        File[] files = dir.listFiles();
        if (files != null) {
            for (File f : files) {
                long s = segStartOf(f.getName());
                if (s > best) {
                    best = s;
                    bestLen = f.length() / 2;
                }
            }
        }
        if (best < 0) {
            // Nothing on disk: after a full release the head is wherever the cursor got to.
            return Math.max(0, committed);
        }
        return best + Math.min(bestLen, SEGMENT_SAMPLES);
    }

    private void readMeta() {
        File f = new File(dir, "meta.json");
        if (!f.isFile()) return;
        try (RandomAccessFile r = new RandomAccessFile(f, "r")) {
            byte[] b = new byte[(int) Math.min(r.length(), 1_000_000)];
            r.readFully(b);
            JSONObject m = new JSONObject(new String(b, "UTF-8"));
            engine = m.optString("engine", "");
            language = m.optString("language", "en");
            startedAt = m.optLong("startedAt", 0);
            state = m.optString("state", "interrupted");
            stoppedReason = m.isNull("stoppedReason") ? null : m.optString("stoppedReason", null);
            committed = m.optLong("committed", 0);
            breaks.clear();
            JSONArray arr = m.optJSONArray("breaks");
            if (arr != null) for (int i = 0; i < arr.length(); i++) breaks.add(arr.optLong(i));
        } catch (Exception e) {
            Log.w(TAG, "meta.json unreadable, using defaults", e);
        }
    }

    private void writeMeta() {
        synchronized (lock) {
            writeMetaLocked();
        }
    }

    private void writeMetaLocked() {
        lastMeta = SystemClock.elapsedRealtime();
        try {
            JSONArray arr = new JSONArray();
            for (long b : breaks) arr.put(b);
            JSONObject m = new JSONObject()
                    .put("v", 1)
                    .put("meetingId", meetingId)
                    .put("engine", engine)
                    .put("language", language)
                    .put("startedAt", startedAt)
                    .put("state", state)
                    .put("stoppedReason", stoppedReason == null ? JSONObject.NULL : stoppedReason)
                    .put("breaks", arr)
                    .put("committed", committed);
            File tmp = new File(dir, "meta.json.tmp");
            try (FileOutputStream o = new FileOutputStream(tmp)) {
                o.write(m.toString().getBytes("UTF-8"));
                o.getFD().sync();
            }
            File dst = new File(dir, "meta.json");
            if (!tmp.renameTo(dst)) {
                dst.delete();
                tmp.renameTo(dst);
            }
        } catch (Exception e) {
            Log.w(TAG, "meta.json write failed", e);
        }
    }
}
