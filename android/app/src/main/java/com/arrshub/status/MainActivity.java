package com.arrshub.status;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApkSharePlugin.class);
        registerPlugin(ExternalPlayerPlugin.class);
        registerPlugin(VlcPlayerPlugin.class);
        registerPlugin(PhotoDumpMediaPlugin.class);
        registerPlugin(PhotoDumpSyncPlugin.class);
        registerPlugin(WindowFlagsPlugin.class);
        registerPlugin(HubWidgetPlugin.class);
        super.onCreate(savedInstanceState);
        deliverShareIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        deliverShareIntent(intent);
    }

    private void deliverShareIntent(Intent intent) {
        if (intent == null || getBridge() == null) return;
        PluginHandle handle = getBridge().getPlugin("PhotoDumpMedia");
        if (handle == null) return;
        if (handle.getInstance() instanceof PhotoDumpMediaPlugin) {
            ((PhotoDumpMediaPlugin) handle.getInstance()).ingestShareIntent(intent);
        }
    }
}
