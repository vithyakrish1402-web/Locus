package com.locus.app;

import android.os.Bundle;
import androidx.core.splashscreen.SplashScreen;
import com.getcapacitor.BridgeActivity;
import com.locus.app.sharing.LocusBackgroundPlugin;
import com.locus.app.sharing.SharingState;
import com.getcapacitor.Plugin;

public class MainActivity extends BridgeActivity {
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        // Locally-defined plugin (no npm package), so Capacitor cannot auto-discover it
        // from node_modules the way it does for @capacitor/app - register it by hand,
        // before super.onCreate() wires up the bridge.
        registerPlugin(LocusUpdaterPlugin.class);
        registerPlugin(WifiScanPlugin.class);
        registerPlugin(LocusBackgroundPlugin.class);
        // The Floor 7 walk recorder exists only in the LOCUS Test build (src/sidetest/java);
        // every other build has no such class, so this finds nothing and registers nothing.
        try {
            registerPlugin(Class.forName("com.locus.app.RecorderPlugin").asSubclass(Plugin.class));
        } catch (ClassNotFoundException ignored) {
        }
        SplashScreen.installSplashScreen(this);
        super.onCreate(savedInstanceState);
    }

    // Background sharing reports at a light heartbeat while the app is on screen (the app's own
    // connection is the source then) and at its full rate once it is not.
    @Override
    public void onStart() {
        super.onStart();
        SharingState.activityStarted();
    }

    @Override
    public void onStop() {
        super.onStop();
        SharingState.activityStopped();
    }
}
