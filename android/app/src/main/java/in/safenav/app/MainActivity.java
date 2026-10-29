package in.safenav.app;

import android.app.AlertDialog;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import org.json.JSONArray;

public class MainActivity extends BridgeActivity {

    /** Home-screen shortcut (long-press the app icon → SOS). */
    static final String ACTION_SOS = "in.safenav.app.SOS";
    /** Link on the offline page, which can't call plugins: safenavsos://send */
    static final String SOS_SCHEME = "safenavsos";

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
        if (intent == null) return;
        Uri data = intent.getData();
        boolean link = Intent.ACTION_VIEW.equals(intent.getAction()) && data != null && SOS_SCHEME.equals(data.getScheme());
        if (!ACTION_SOS.equals(intent.getAction()) && !link) return;
        // Clear it so a rotation or relaunch doesn't send a second SOS.
        setIntent(new Intent(this, MainActivity.class));
        if (link) {
            // Any web page could link here, so a link never sends without asking.
            new AlertDialog.Builder(this)
                .setTitle("Send SOS?")
                .setMessage("Text your trusted contacts now with your location.")
                .setPositiveButton("Send SOS", (d, w) -> send(true))
                .setNegativeButton("Cancel", null)
                .show();
        } else {
            // The shortcut is a deliberate choice: send at once, without waiting for the web app to load.
            send(false);
        }
    }

    private void send(boolean report) {
        SosNative.run(this, "shortcut", (outcome) -> {
            SosNative.prefs(this).edit().putString("pendingSos", outcome.toString()).apply();
            SafeNavNativePlugin.emitNativeSos(outcome);
            if (!report || isFinishing()) return;
            JSONArray sms = outcome.optJSONArray("sms");
            int ok = 0;
            if (sms != null) for (int i = 0; i < sms.length(); i++) if (sms.optJSONObject(i) != null && sms.optJSONObject(i).optBoolean("ok")) ok++;
            String msg = ok > 0
                ? "SOS texted to " + ok + (ok == 1 ? " contact." : " contacts.") + " Call 112 if you are in danger."
                : (sms == null || sms.length() == 0 ? "No trusted contacts are saved on this phone, or SMS isn't allowed. Call 112." : "The SMS hasn't gone through yet. Call 112.");
            new AlertDialog.Builder(this).setTitle(ok > 0 ? "SOS sent" : "SOS not sent").setMessage(msg).setPositiveButton("OK", null).show();
        });
    }
}
