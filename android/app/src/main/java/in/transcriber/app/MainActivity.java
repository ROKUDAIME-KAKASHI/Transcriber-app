package in.transcriber.app;

import android.os.Bundle;
import android.util.Log;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.WebView;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.WebViewListener;

import in.transcriber.app.export.DocumentExportPlugin;
import in.transcriber.app.recorder.MeetingRecorderPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MeetingRecorderPlugin.class);
        registerPlugin(DocumentExportPlugin.class);
        super.onCreate(savedInstanceState);
        // If the WebView's renderer is killed (out of memory with the speech models loaded, or by the
        // system while the screen is locked) and nobody handles it, Android kills this whole process,
        // and the recording foreground service with it. Handling it keeps the process alive; the page
        // is rebuilt and resumes from the audio files.
        getBridge().addWebViewListener(new WebViewListener() {
            @Override
            public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
                Log.w("MainActivity", "WebView renderer gone, crashed=" + detail.didCrash());
                runOnUiThread(MainActivity.this::recreate);
                return true;
            }
        });
    }
}
