package in.transcriber.app;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import in.transcriber.app.export.DocumentExportPlugin;
import in.transcriber.app.recorder.MeetingRecorderPlugin;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(MeetingRecorderPlugin.class);
        registerPlugin(DocumentExportPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
