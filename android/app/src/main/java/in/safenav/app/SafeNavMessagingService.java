package in.safenav.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Intent;
import android.os.Build;
import androidx.annotation.NonNull;
import androidx.core.app.NotificationCompat;
import androidx.core.content.ContextCompat;
import com.google.firebase.messaging.FirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

/**
 * Alerts from the server about people you protect. An SOS starts the alarm
 * (SosAlarmService); everything else is an ordinary notification.
 */
public class SafeNavMessagingService extends FirebaseMessagingService {

    private static final String CHANNEL_UPDATES = "people_updates";

    @Override
    public void onNewToken(@NonNull String token) {
        // The web app registers it with the server the next time it runs.
        SosNative.prefs(this).edit().putString("fcmToken", token).putBoolean("fcmTokenDirty", true).apply();
        SafeNavNativePlugin.emitPushToken(token);
    }

    @Override
    public void onMessageReceived(@NonNull RemoteMessage message) {
        Map<String, String> d = message.getData();
        String kind = d.get("kind");
        String title = d.get("title") != null ? d.get("title") : "SafeNav";
        String body = d.get("body") != null ? d.get("body") : "";
        String url = d.get("url");
        if ("sos".equals(kind)) {
            Intent i = new Intent(this, SosAlarmService.class)
                .setAction(SosAlarmService.ACTION_RING)
                .putExtra("title", title)
                .putExtra("body", body)
                .putExtra("url", url)
                .putExtra("tripId", d.get("tripId"));
            // High-priority FCM messages may start a foreground service from the background.
            ContextCompat.startForegroundService(this, i);
            return;
        }
        if ("safe".equals(kind)) {
            startService(new Intent(this, SosAlarmService.class).setAction(SosAlarmService.ACTION_STOP).putExtra("tripId", d.get("tripId")));
        }
        notifyUpdate(title, body, url);
    }

    private void notifyUpdate(String title, String body, String url) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel ch = new NotificationChannel(CHANNEL_UPDATES, "People you protect", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Journeys, safe arrivals and check-ins of people who added you");
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class).putExtra(MainActivity.EXTRA_URL, url).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent pi = PendingIntent.getActivity(this, (int) System.currentTimeMillis(), open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        nm.notify((int) (System.currentTimeMillis() & 0xffff) + 100, new NotificationCompat.Builder(this, CHANNEL_UPDATES)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setAutoCancel(true)
            .setContentIntent(pi)
            .build());
    }
}
