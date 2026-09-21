package com.locus.wifisurvey;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Local plugin (no npm package), so Capacitor can't auto-discover it the way it
        // does @capacitor/geolocation. Register it by hand before super.onCreate() wires up the bridge.
        registerPlugin(WifiSurveyPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
