package com.arrshub.status;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApkSharePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
