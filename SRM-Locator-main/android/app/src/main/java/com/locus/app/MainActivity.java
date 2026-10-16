package com.locus.app;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.locus.app.sharing.LocusBackgroundPlugin;
import com.locus.app.sharing.SharingState;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Locally-defined plugin (no npm package), so Capacitor cannot auto-discover it
        // from node_modules the way it does for @capacitor/app - register it by hand,
        // before super.onCreate() wires up the bridge.
        registerPlugin(LocusUpdaterPlugin.class);
        registerPlugin(WifiScanPlugin.class);
        registerPlugin(LocusBackgroundPlugin.class);
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
    }

    // Background sharing reports at a light heartbeat while the app is live (in the foreground, its
    // JavaScript running: the app's own connection is the source then) and at its full rate from the
    // moment it is not. The WebView freezes at onPause, so that is the moment that counts; these are
    // native callbacks and still fire when JavaScript has stopped.
    @Override
    public void onResume() {
        super.onResume();
        SharingState.activityResumed();
    }

    @Override
    public void onPause() {
        // Before super: Capacitor freezes the WebView in super.onPause().
        SharingState.activityPaused();
        super.onPause();
    }
}
