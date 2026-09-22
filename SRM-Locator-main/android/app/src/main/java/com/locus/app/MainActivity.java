package com.locus.app;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Locally-defined plugin (no npm package), so Capacitor cannot auto-discover it
        // from node_modules the way it does for @capacitor/app - register it by hand,
        // before super.onCreate() wires up the bridge.
        registerPlugin(LocusUpdaterPlugin.class);
        registerPlugin(WifiScanPlugin.class);
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
    }
}
