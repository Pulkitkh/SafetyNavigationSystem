package in.safenav.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.util.ArrayDeque;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * Shake-to-SOS that keeps working with the screen off and the app closed.
 *
 * A hard shake (the same rule as the web app: 4 peaks over 18 m/s² within 2 s)
 * shows a countdown notification the user can cancel; when it runs out the
 * native SOS sends SMS and alerts. While the app is open the web app runs its
 * own countdown screen instead.
 */
public class ShakeGuardService extends Service implements SensorEventListener {

    static final String ACTION_START = "in.safenav.app.GUARD_START";
    static final String ACTION_STOP = "in.safenav.app.GUARD_STOP";
    static final String ACTION_CANCEL = "in.safenav.app.GUARD_CANCEL";
    static final String ACTION_SEND_NOW = "in.safenav.app.GUARD_SEND_NOW";

    private static final String CHANNEL_GUARD = "guard";
    private static final String CHANNEL_SOS = "sos";
    private static final int ID_GUARD = 41;
    private static final int ID_SOS = 42;

    private static final float PEAK_MS2 = 18f;
    private static final int PEAKS_NEEDED = 4;
    private static final long WINDOW_MS = 2000;

    static volatile boolean running = false;

    private final Handler main = new Handler(Looper.getMainLooper());
    private final ArrayDeque<Long> peaks = new ArrayDeque<>();
    private boolean above = false;
    private int countdown = -1;
    private boolean sending = false;
    private SensorManager sensors;
    private PowerManager.WakeLock wakeLock;

    static void start(Context ctx) {
        Intent i = new Intent(ctx, ShakeGuardService.class).setAction(ACTION_START);
        ContextCompat.startForegroundService(ctx, i);
    }

    static void stop(Context ctx) {
        ctx.startService(new Intent(ctx, ShakeGuardService.class).setAction(ACTION_STOP));
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent != null && intent.getAction() != null ? intent.getAction() : ACTION_START;
        switch (action) {
            case ACTION_STOP:
                SosNative.prefs(this).edit().putBoolean("guard", false).apply();
                stopGuard();
                return START_NOT_STICKY;
            case ACTION_CANCEL:
                cancelCountdown();
                return START_STICKY;
            case ACTION_SEND_NOW:
                if (countdown >= 0) {
                    countdown = 0;
                    main.removeCallbacks(tick);
                    main.post(tick);
                }
                return START_STICKY;
            default:
                if (!SosNative.prefs(this).getBoolean("guard", false)) {
                    stopSelf();
                    return START_NOT_STICKY;
                }
                if (!startInForeground()) {
                    stopSelf();
                    return START_NOT_STICKY;
                }
                listen();
                return START_STICKY;
        }
    }

    private boolean startInForeground() {
        createChannels();
        Notification n = guardNotification();
        int types = 0;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            types = ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE;
            if (SosNative.hasLocationPermission(this)) types |= ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            types = ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION;
        }
        try {
            ServiceCompat.startForeground(this, ID_GUARD, n, types);
        } catch (RuntimeException e) {
            // Location type can be refused when started from the background; shake detection still works without it.
            try {
                int fallback = Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE ? ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE : 0;
                ServiceCompat.startForeground(this, ID_GUARD, n, fallback);
            } catch (RuntimeException e2) {
                return false;
            }
        }
        running = true;
        return true;
    }

    private void listen() {
        if (sensors != null) return;
        sensors = (SensorManager) getSystemService(SENSOR_SERVICE);
        Sensor acc = sensors != null ? sensors.getDefaultSensor(Sensor.TYPE_ACCELEROMETER) : null;
        if (acc == null) {
            stopGuard();
            return;
        }
        sensors.registerListener(this, acc, SensorManager.SENSOR_DELAY_GAME);
        // Many phones stop delivering sensor events with the screen off unless the CPU is kept awake.
        PowerManager pm = (PowerManager) getSystemService(POWER_SERVICE);
        if (pm != null) {
            wakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "SafeNav:shake-guard");
            wakeLock.setReferenceCounted(false);
            wakeLock.acquire();
        }
    }

    private void stopGuard() {
        running = false;
        if (sensors != null) sensors.unregisterListener(this);
        sensors = null;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        main.removeCallbacks(tick);
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        if (sensors != null) sensors.unregisterListener(this);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        super.onDestroy();
    }

    @Override
    public void onSensorChanged(SensorEvent e) {
        float x = e.values[0], y = e.values[1], z = e.values[2];
        double magnitude = Math.sqrt(x * x + y * y + z * z);
        boolean strong = Math.abs(magnitude - SensorManager.GRAVITY_EARTH) >= PEAK_MS2;
        long now = SystemClock.elapsedRealtime();
        if (strong && !above) {
            while (!peaks.isEmpty() && now - peaks.peekFirst() > WINDOW_MS) peaks.pollFirst();
            peaks.addLast(now);
            if (peaks.size() >= PEAKS_NEEDED) {
                peaks.clear();
                onShake();
            }
        }
        above = strong;
    }

    @Override
    public void onAccuracyChanged(Sensor sensor, int accuracy) {}

    private void onShake() {
        if (countdown >= 0 || sending) return;
        // The open app shows its own full-screen countdown.
        if (SafeNavNativePlugin.emitShake()) return;
        vibrate(new long[] { 0, 200, 100, 200 });
        countdown = Math.max(0, SosNative.prefs(this).getInt("countdownS", 5));
        main.post(tick);
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (countdown < 0) return;
            if (countdown == 0) {
                countdown = -1;
                fire();
                return;
            }
            notifySos(countdownNotification(countdown));
            countdown--;
            main.postDelayed(this, 1000);
        }
    };

    private void cancelCountdown() {
        countdown = -1;
        main.removeCallbacks(tick);
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(ID_SOS);
    }

    private void fire() {
        sending = true;
        vibrate(new long[] { 0, 300, 150, 300, 150, 600 });
        notifySos(progressNotification());
        SosNative.run(this, "shake", (outcome) -> {
            sending = false;
            SosNative.prefs(this).edit().putString("pendingSos", outcome.toString()).apply();
            SafeNavNativePlugin.emitNativeSos(outcome);
            notifySos(sentNotification(outcome));
        });
    }

    private void vibrate(long[] pattern) {
        Vibrator v = (Vibrator) getSystemService(VIBRATOR_SERVICE);
        if (v == null) return;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) v.vibrate(VibrationEffect.createWaveform(pattern, -1));
        else v.vibrate(pattern, -1);
    }

    // ------------------------------------------------------------ notifications

    private void createChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm == null) return;
        NotificationChannel guard = new NotificationChannel(CHANNEL_GUARD, "Shake to SOS", NotificationManager.IMPORTANCE_LOW);
        guard.setDescription("Shown while SafeNav is listening for a shake");
        guard.setShowBadge(false);
        nm.createNotificationChannel(guard);
        NotificationChannel sos = new NotificationChannel(CHANNEL_SOS, "SOS", NotificationManager.IMPORTANCE_HIGH);
        sos.setDescription("SOS countdown and delivery");
        sos.enableVibration(true);
        sos.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(sos);
    }

    private PendingIntent openApp() {
        Intent i = new Intent(this, MainActivity.class).setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(this, 0, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private PendingIntent serviceAction(String action, int code) {
        Intent i = new Intent(this, ShakeGuardService.class).setAction(action);
        return PendingIntent.getService(this, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private Notification guardNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_GUARD)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle("Shake to SOS is on")
            .setContentText("Shake your phone hard to alert your trusted contacts, even with the screen locked.")
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openApp())
            .addAction(0, "Turn off", serviceAction(ACTION_STOP, 1))
            .build();
    }

    private Notification countdownNotification(int s) {
        return new NotificationCompat.Builder(this, CHANNEL_SOS)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle("Sending SOS in " + s + " s")
            .setContentText("Shake detected. Tap Cancel if you're OK.")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOnlyAlertOnce(true)
            .setOngoing(true)
            .setColor(0xFFE11D48)
            .addAction(0, "Cancel, I'm OK", serviceAction(ACTION_CANCEL, 2))
            .addAction(0, "Send now", serviceAction(ACTION_SEND_NOW, 3))
            .build();
    }

    private Notification progressNotification() {
        return new NotificationCompat.Builder(this, CHANNEL_SOS)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle("Sending SOS…")
            .setContentText("Texting your trusted contacts with your location.")
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setOngoing(true)
            .setProgress(0, 0, true)
            .setColor(0xFFE11D48)
            .build();
    }

    private Notification sentNotification(JSONObject outcome) {
        int ok = 0, total = 0;
        JSONArray sms = outcome.optJSONArray("sms");
        if (sms != null) {
            total = sms.length();
            for (int i = 0; i < sms.length(); i++) if (sms.optJSONObject(i) != null && sms.optJSONObject(i).optBoolean("ok")) ok++;
        }
        String title = ok > 0 ? "SOS sent to " + ok + " contact" + (ok == 1 ? "" : "s") : total > 0 ? "SOS SMS not delivered yet" : "SOS raised";
        String text = "ok".equals(outcome.optString("server")) ? "Live location is being shared. Tap to open SafeNav." : "Tap to open SafeNav and call 112 if you need to.";
        return new NotificationCompat.Builder(this, CHANNEL_SOS)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle(title)
            .setContentText(text)
            .setPriority(NotificationCompat.PRIORITY_MAX)
            .setCategory(NotificationCompat.CATEGORY_ALARM)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
            .setColor(0xFFE11D48)
            .setAutoCancel(true)
            .setContentIntent(openApp())
            .build();
    }

    private void notifySos(Notification n) {
        NotificationManager nm = (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (nm != null) nm.notify(ID_SOS, n);
    }
}
