package in.transcriber.app.recorder;

import android.Manifest;
import android.annotation.SuppressLint;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONException;
import org.json.JSONObject;

import android.util.Base64;

import java.io.IOException;
import java.util.List;

/**
 * The web app's handle on the native recorder (src/lib/nativeRecorder.ts).
 * Recording itself lives in RecordingService and carries on without the page.
 */
@CapacitorPlugin(
        name = "MeetingRecorder",
        permissions = {
                @Permission(alias = "microphone", strings = {Manifest.permission.RECORD_AUDIO}),
                @Permission(alias = "notifications", strings = {Manifest.permission.POST_NOTIFICATIONS}),
        }
)
public class MeetingRecorderPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        boolean local = RecordingService.MODE_LOCAL.equals(call.getString("mode"));
        if (local) {
            if (!LocalCapture.validId(call.getString("meetingId"))) {
                call.reject("a valid meetingId is required");
                return;
            }
        } else if (call.getString("meetingId") == null || call.getString("baseUrl") == null) {
            call.reject("meetingId and baseUrl are required");
            return;
        }
        if (getPermissionState("microphone") != PermissionState.GRANTED
                || (Build.VERSION.SDK_INT >= 33 && getPermissionState("notifications") == PermissionState.PROMPT)) {
            requestPermissionForAliases(new String[]{"microphone", "notifications"}, call, "permissionsDone");
            return;
        }
        startService(call);
    }

    @PermissionCallback
    private void permissionsDone(PluginCall call) {
        if (getPermissionState("microphone") != PermissionState.GRANTED) {
            call.reject("Microphone access was denied. Allow it in Settings › Apps › Transcriber › Permissions.", "DENIED");
            return;
        }
        // Notifications are optional: without them recording still runs, the notice is just hidden.
        startService(call);
    }

    private void startService(PluginCall call) {
        Context ctx = getContext();
        Intent i = new Intent(ctx, RecordingService.class)
                .setAction(RecordingService.ACTION_START)
                .putExtra(RecordingService.EXTRA_MEETING_ID, call.getString("meetingId"))
                .putExtra(RecordingService.EXTRA_LANGUAGE, call.getString("language", "en"))
                .putExtra(RecordingService.EXTRA_BASE_URL, call.getString("baseUrl"));
        if (RecordingService.MODE_LOCAL.equals(call.getString("mode"))) {
            i.putExtra(RecordingService.EXTRA_MODE, RecordingService.MODE_LOCAL)
                    .putExtra(RecordingService.EXTRA_ENGINE, call.getString("engine", ""));
        }
        try {
            ContextCompat.startForegroundService(ctx, i);
            call.resolve();
        } catch (Exception e) {
            call.reject("Could not start recording: " + e.getMessage());
        }
    }

    @PluginMethod
    public void stop(PluginCall call) {
        boolean force = Boolean.TRUE.equals(call.getBoolean("force", false));
        android.util.Log.i("MeetingRecorderPlugin", "stop() from page, force=" + force);
        send(force ? RecordingService.ACTION_FORCE_STOP : RecordingService.ACTION_STOP);
        call.resolve();
    }

    @PluginMethod
    public void pause(PluginCall call) {
        send(RecordingService.ACTION_PAUSE);
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        send(RecordingService.ACTION_RESUME);
        call.resolve();
    }

    private void send(String action) {
        if (!RecordingService.active) return;
        Context ctx = getContext();
        ctx.startService(new Intent(ctx, RecordingService.class).setAction(action));
    }

    /** Everything the Record screen shows. `from`: return transcript parts from this index on. */
    @PluginMethod
    public void getState(PluginCall call) {
        int from = Math.max(0, call.getInt("from", 0));
        JSObject out = new JSObject();
        synchronized (RecordingService.LOCK) {
            out.put("active", RecordingService.active);
            out.put("paused", RecordingService.paused);
            out.put("finishing", RecordingService.finishing);
            out.put("finished", RecordingService.finished);
            out.put("meetingId", RecordingService.meetingId);
            out.put("status", RecordingService.status);
            out.put("saveState", RecordingService.saveState);
            out.put("interim", RecordingService.interim);
            out.put("noSound", RecordingService.noSound);
            out.put("stoppedRemotely", RecordingService.stoppedRemotely);
            out.put("online", RecordingService.online);
            out.put("backlogSeconds", RecordingService.backlogSeconds);
            out.put("level", RecordingService.level);
            out.put("seconds", RecordingService.recordedSamples / RecordingService.SAMPLE_RATE);
            out.put("mode", RecordingService.localMode ? "local" : "cloud");
            LocalCapture lc = LocalCapture.current;
            if (RecordingService.localMode && lc != null) {
                out.put("headSamples", lc.head());
                out.put("committed", lc.committed());
                out.put("freeBytes", LocalCapture.freeBytes(getContext()));
                out.put("stoppedReason", lc.stoppedReason());
            }
            out.put("partsCount", RecordingService.parts.size());
            out.put("from", Math.min(from, RecordingService.parts.size()));
            JSArray arr = new JSArray();
            try {
                for (int i = from; i < RecordingService.parts.size(); i++) arr.put(RecordingService.parts.get(i).toJson());
            } catch (JSONException ignored) {
            }
            out.put("parts", arr);
        }
        call.resolve(out);
    }

    // ---- Local (offline) capture: read what the service recorded ------------------------------------

    /** Old APKs reject this call (UNIMPLEMENTED): the page treats that as "no local capture". */
    @PluginMethod
    public void capabilities(PluginCall call) {
        JSObject out = new JSObject();
        out.put("version", 2);
        out.put("localCapture", true);
        out.put("segmentSamples", LocalCapture.SEGMENT_SAMPLES);
        out.put("sampleRate", LocalCapture.SAMPLE_RATE);
        call.resolve(out);
    }

    /**
     * readAudio({ meetingId, from, maxSamples }) -> { from, samples, data (base64 s16le), head, ended, breaks }.
     * Reads at most one segment (the page loops) and at most 30 s. Rejects with code GONE when that audio was released.
     */
    @PluginMethod
    public void readAudio(PluginCall call) {
        String id = call.getString("meetingId");
        LocalCapture lc = LocalCapture.validId(id) ? LocalCapture.load(getContext(), id) : null;
        if (lc == null) {
            call.reject("No recording on this phone for that meeting", "NOT_FOUND");
            return;
        }
        long from = Math.max(0, call.getData().optLong("from", 0));
        long max = Math.max(0, Math.min(LocalCapture.MAX_READ_SAMPLES, call.getData().optLong("maxSamples", LocalCapture.SAMPLE_RATE * 2L)));
        try {
            LocalCapture.Chunk c = lc.read(from, max);
            JSObject out = new JSObject();
            out.put("from", c.from);
            out.put("samples", c.samples);
            out.put("data", c.samples == 0 ? "" : Base64.encodeToString(c.data, Base64.NO_WRAP));
            out.put("head", c.head);
            out.put("ended", c.ended);
            JSArray br = new JSArray();
            for (long b : c.breaks) br.put(b);
            out.put("breaks", br);
            call.resolve(out);
        } catch (IOException e) {
            if ("GONE".equals(e.getMessage())) call.reject("That audio was already released", "GONE");
            else call.reject("Could not read the recording: " + e.getMessage(), "IO");
        }
    }

    /** releaseAudio({ meetingId, before }) -> { freedBytes }: deletes whole segments that end at or before `before`. */
    @PluginMethod
    public void releaseAudio(PluginCall call) {
        String id = call.getString("meetingId");
        LocalCapture lc = LocalCapture.validId(id) ? LocalCapture.load(getContext(), id) : null;
        if (lc == null) {
            call.reject("No recording on this phone for that meeting", "NOT_FOUND");
            return;
        }
        long before = Math.max(0, call.getData().optLong("before", 0));
        JSObject out = new JSObject();
        out.put("freedBytes", lc.release(before));
        call.resolve(out);
    }

    /** listCaptures() -> { captures: [{ meetingId, head, committed, state, stoppedReason, startedAt, engine, language, active }] } */
    @PluginMethod
    public void listCaptures(PluginCall call) {
        JSArray arr = new JSArray();
        String activeId;
        synchronized (RecordingService.LOCK) {
            activeId = RecordingService.active && RecordingService.localMode ? RecordingService.meetingId : null;
        }
        List<LocalCapture> all = LocalCapture.listAll(getContext());
        for (LocalCapture lc : all) {
            try {
                arr.put(lc.info(lc.meetingId.equals(activeId)));
            } catch (JSONException ignored) {
            }
        }
        JSObject out = new JSObject();
        out.put("captures", arr);
        call.resolve(out);
    }

    /** discardCapture({ meetingId }): deletes the audio folder. Refuses while that meeting is being captured. */
    @PluginMethod
    public void discardCapture(PluginCall call) {
        String id = call.getString("meetingId");
        if (!LocalCapture.validId(id)) {
            call.reject("a valid meetingId is required");
            return;
        }
        boolean capturingNow;
        synchronized (RecordingService.LOCK) {
            capturingNow = RecordingService.active && RecordingService.localMode && id.equals(RecordingService.meetingId);
        }
        if (capturingNow) {
            call.reject("That meeting is still being recorded", "ACTIVE");
            return;
        }
        LocalCapture lc = LocalCapture.load(getContext(), id);
        if (lc != null && !lc.discard()) {
            call.reject("Could not delete the recording", "ACTIVE");
            return;
        }
        call.resolve();
    }

    /** Phone makers' battery savers are the main thing that can still stop a long recording. */
    @PluginMethod
    public void batteryStatus(PluginCall call) {
        PowerManager pm = (PowerManager) getContext().getSystemService(Context.POWER_SERVICE);
        JSObject out = new JSObject();
        out.put("unrestricted", pm == null || pm.isIgnoringBatteryOptimizations(getContext().getPackageName()));
        out.put("manufacturer", Build.MANUFACTURER);
        call.resolve(out);
    }

    @SuppressLint("BatteryLife") // a recorder that must run for hours is the intended use
    @PluginMethod
    public void requestUnrestrictedBattery(PluginCall call) {
        Context ctx = getContext();
        try {
            Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + ctx.getPackageName()));
            getActivity().startActivity(i);
        } catch (Exception e) {
            try {
                getActivity().startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            } catch (Exception ignored) {
            }
        }
        call.resolve();
    }
}
