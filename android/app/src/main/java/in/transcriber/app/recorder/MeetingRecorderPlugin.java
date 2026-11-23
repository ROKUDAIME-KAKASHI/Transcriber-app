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
        if (call.getString("meetingId") == null || call.getString("baseUrl") == null) {
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
