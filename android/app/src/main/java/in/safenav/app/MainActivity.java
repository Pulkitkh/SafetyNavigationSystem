package in.safenav.app;

import android.content.Intent;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Home-screen shortcut (long-press the app icon → SOS). */
    static final String ACTION_SOS = "in.safenav.app.SOS";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SafeNavNativePlugin.class);
        super.onCreate(savedInstanceState);
        // Shake guard comes back after the app was swiped away or the phone restarted.
        if (SosNative.prefs(this).getBoolean("guard", false) && !ShakeGuardService.running) {
            try {
                ShakeGuardService.start(this);
            } catch (RuntimeException ignored) {
                // The app will offer to turn it on again.
            }
        }
        handle(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handle(intent);
    }

    private void handle(Intent intent) {
        if (intent == null || !ACTION_SOS.equals(intent.getAction())) return;
        // Clear it so a rotation or relaunch doesn't send a second SOS.
        setIntent(new Intent(this, MainActivity.class));
        // The user chose SOS deliberately: send at once, without waiting for the web app to load.
        SosNative.run(this, "shortcut", (outcome) -> {
            SosNative.prefs(this).edit().putString("pendingSos", outcome.toString()).apply();
            SafeNavNativePlugin.emitNativeSos(outcome);
        });
    }
}
