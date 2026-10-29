package in.safenav.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.media.AudioManager;
import android.media.MediaPlayer;
import android.media.RingtoneManager;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.VibrationEffect;
import android.os.Vibrator;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;

/**
 * Rings like an alarm when someone you protect raises an SOS: the alarm sound
 * on the alarm volume (which plays even when the phone is on silent), strong
 * vibration and a full-screen alert, until you open it or silence it, or for
 * three minutes at most.
 */
public class SosAlarmService extends Service {

    static final String ACTION_RING = "in.safenav.app.ALARM_RING";
    static final String ACTION_STOP = "in.safenav.app.ALARM_STOP";

    private static final String CHANNEL = "sos_incoming";
    private static final int ID = 51;
    private static final long MAX_RING_MS = 3 * 60_000;

    private final Handler main = new Handler(Looper.getMainLooper());
    private MediaPlayer player;
    private Vibrator vibrator;
    private PowerManager.WakeLock wakeLock;
    private int savedVolume = -1;
    private String tripId;
    private String lastTitle = "SOS";
    private String lastBody = "";
    private String lastUrl;

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null ? intent.getAction() : null;
        if (ACTION_STOP.equals(action)) {
            String t = intent.getStringExtra("tripId");
            // "Safe" for another SOS mustn't silence this one.
            if (t == null || tripId == null || t.equals(tripId)) stopRinging();
            return START_NOT_STICKY;
        }
        if (!ACTION_RING.equals(action)) {
            stopSelf();
            return START_NOT_STICKY;
        }
        tripId = intent.getStringExtra("tripId");
        String title = intent.getStringExtra("title");
        String body = intent.getStringExtra("body");
        String url = intent.getStringExtra("url");
        lastTitle = title != null ? title : "SOS";
        lastBody = body != null ? body : "";
        lastUrl = url;
        Notification n = notification(lastTitle, lastBody, url, true);
        try {
            int type = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
            ServiceCompat.startForeground(this, ID, n, type);
        } catch (RuntimeException e) {
            // Couldn't go foreground: still show the alert.
            NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(ID, n);
        }
        ring();
        main.removeCallbacksAndMessages(null);
        main.postDelayed(this::stopRinging, MAX_RING_MS);
        return START_NOT_STICKY;
    }

    private void ring() {
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null && wakeLock == null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SafeNav:sos-alarm");
            wakeLock.acquire(MAX_RING_MS + 10_000);
        }
        if (player == null) {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) {
                savedVolume = am.getStreamVolume(AudioManager.STREAM_ALARM);
                am.setStreamVolume(AudioManager.STREAM_ALARM, am.getStreamMaxVolume(AudioManager.STREAM_ALARM), 0);
            }
            Uri sound = RingtoneManager.getActualDefaultRingtoneUri(this, RingtoneManager.TYPE_ALARM);
            if (sound == null) sound = RingtoneManager.getDefaultUri(RingtoneManager.TYPE_RINGTONE);
            try {
                player = new MediaPlayer();
                player.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ALARM).setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION).build());
                player.setDataSource(this, sound);
                player.setLooping(true);
                player.prepare();
                player.start();
            } catch (Exception e) {
                player = null;
            }
        }
        vibrator = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        if (vibrator != null) {
            long[] pattern = { 0, 800, 400, 800, 400, 1600, 800 };
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) vibrator.vibrate(VibrationEffect.createWaveform(pattern, 0));
            else vibrator.vibrate(pattern, 0);
        }
    }

    private void stopRinging() {
        main.removeCallbacksAndMessages(null);
        if (player != null) {
            try {
                player.stop();
            } catch (IllegalStateException ignored) {
                // already stopped
            }
            player.release();
            player = null;
        }
        if (savedVolume >= 0) {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null) am.setStreamVolume(AudioManager.STREAM_ALARM, savedVolume, 0);
            savedVolume = -1;
        }
        if (vibrator != null) vibrator.cancel();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
        // Keep the alert visible, now silent and dismissable.
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_DETACH);
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null && tripId != null) nm.notify(ID, notification(lastTitle, lastBody, lastUrl, false));
        stopSelf();
    }

    @Override
    public void onDestroy() {
        if (player != null) player.release();
        if (vibrator != null) vibrator.cancel();
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    private Notification notification(String title, String body, String url, boolean ringing) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O && nm != null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "SOS from people you protect", NotificationManager.IMPORTANCE_HIGH);
            ch.setDescription("Rings loudly when someone who added you raises an SOS");
            ch.setSound(null, null); // the service plays the alarm itself, on the alarm volume
            ch.enableVibration(false);
            ch.setBypassDnd(true);
            ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            nm.createNotificationChannel(ch);
        }
        Intent open = new Intent(this, MainActivity.class)
            .putExtra(MainActivity.EXTRA_URL, url)
            .putExtra(MainActivity.EXTRA_STOP_ALARM, true)
            .setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        PendingIntent openPi = PendingIntent.getActivity(this, 1, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        PendingIntent silence = PendingIntent.getService(this, 2, new Intent(this, SosAlarmService.class).setAction(ACTION_STOP), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setColor(0xFFE11D48)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(ringing)
            .setAutoCancel(true)
            .setContentIntent(openPi);
        if (ringing) {
            // Shows over the lock screen like an incoming call where the phone allows it.
            b.setFullScreenIntent(openPi, true).addAction(0, "Open live location", openPi).addAction(0, "Silence", silence);
        } else {
            b.addAction(0, "Open live location", openPi);
        }
        return b.build();
    }
}
