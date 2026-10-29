package in.safenav.app;

import android.app.Application;
import android.content.Context;
import android.content.SharedPreferences;
import com.google.firebase.FirebaseApp;
import com.google.firebase.FirebaseOptions;

/**
 * Starts Firebase as soon as the process starts, so an SOS message is handled
 * even when SafeNav was closed. The settings come from the server and are
 * saved by SafeNavNativePlugin.initPush.
 */
public class SafeNavApp extends Application {

    @Override
    public void onCreate() {
        super.onCreate();
        initFirebase(this);
    }

    static boolean initFirebase(Context ctx) {
        try {
            if (!FirebaseApp.getApps(ctx).isEmpty()) return true;
            SharedPreferences p = SosNative.prefs(ctx);
            String appId = p.getString("fcmAppId", null);
            String apiKey = p.getString("fcmApiKey", null);
            String projectId = p.getString("fcmProjectId", null);
            String senderId = p.getString("fcmSenderId", null);
            if (appId == null || apiKey == null || projectId == null || senderId == null) return false;
            FirebaseOptions options = new FirebaseOptions.Builder()
                .setApplicationId(appId)
                .setApiKey(apiKey)
                .setProjectId(projectId)
                .setGcmSenderId(senderId)
                .build();
            FirebaseApp.initializeApp(ctx, options);
            return true;
        } catch (RuntimeException e) {
            return false;
        }
    }
}
