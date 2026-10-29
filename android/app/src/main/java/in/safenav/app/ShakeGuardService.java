package in.safenav.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.BatteryManager;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import android.os.SystemClock;
import android.os.VibrationEffect;
import android.os.Vibrator;
import android.webkit.CookieManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.ServiceCompat;
import androidx.core.content.ContextCompat;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
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
    static final String ACTION_STOP_ALL = "in.safenav.app.GUARD_STOP_ALL";

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

    /** Runs the service while shake to SOS or always-on sharing is on, and stops it when neither is. */
    static void sync(Context ctx) {
        SharedPreferences p = SosNative.prefs(ctx);
        if (p.getBoolean("guard", false) || p.getBoolean("shareLive", false)) start(ctx);
        else if (running) ctx.startService(new Intent(ctx, ShakeGuardService.class).setAction(ACTION_STOP_ALL));
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
                // "Turn off" on the notification: shake only. Location sharing is switched off in the app.
                SosNative.prefs(this).edit().putBoolean("guard", false).apply();
                if (SosNative.prefs(this).getBoolean("shareLive", false)) {
                    stopShake();
                    startInForeground();
                    return START_STICKY;
                }
                stopGuard();
                return START_NOT_STICKY;
            case ACTION_STOP_ALL:
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
                boolean guard = SosNative.prefs(this).getBoolean("guard", false);
                boolean share = SosNative.prefs(this).getBoolean("shareLive", false);
                if (!guard && !share) {
                    stopGuard();
                    return START_NOT_STICKY;
                }
                if (!startInForeground()) {
                    stopSelf();
                    return START_NOT_STICKY;
                }
                if (guard) listen();
                else stopShake();
                if (share) startSharing();
                else stopSharing();
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

    private void stopShake() {
        if (sensors != null) sensors.unregisterListener(this);
        sensors = null;
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        wakeLock = null;
    }

    // ------------------------------------------------------------ always-on sharing

    private static final long SHARE_EVERY_MS = 60_000;
    private static final float SHARE_MOVED_M = 30f;
    private LocationListener shareListener;
    private long lastShareAt = 0;
    private final ExecutorService uploads = Executors.newSingleThreadExecutor();

    /** Reports the location to the server about once a minute (sooner after moving), with the app closed too. */
    @SuppressWarnings("MissingPermission")
    private void startSharing() {
        if (shareListener != null || !SosNative.hasLocationPermission(this)) return;
        LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (lm == null) return;
        // A full class, not a lambda: Android 10 and older call the other methods too.
        shareListener = new LocationListener() {
            @Override
            public void onLocationChanged(Location location) {
                upload(location);
            }

            @Override
            public void onStatusChanged(String provider, int status, android.os.Bundle extras) {}

            @Override
            public void onProviderEnabled(String provider) {}

            @Override
            public void onProviderDisabled(String provider) {}
        };
        for (String provider : new String[] { LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER }) {
            try {
                if (lm.isProviderEnabled(provider)) lm.requestLocationUpdates(provider, SHARE_EVERY_MS, SHARE_MOVED_M, shareListener, Looper.getMainLooper());
            } catch (RuntimeException ignored) {
                // provider missing on this device
            }
        }
        Location known = SosNative.lastKnown(this);
        if (known != null) upload(known);
    }

    private void stopSharing() {
        if (shareListener == null) return;
        LocationManager lm = (LocationManager) getSystemService(LOCATION_SERVICE);
        if (lm != null) lm.removeUpdates(shareListener);
        shareListener = null;
    }

    private void upload(Location loc) {
        long now = System.currentTimeMillis();
        // GPS and network both report; one upload per interval is enough.
        if (now - lastShareAt < SHARE_EVERY_MS / 2) return;
        lastShareAt = now;
        String base = SosNative.prefs(this).getString("baseUrl", "");
        if (base.isEmpty()) return;
        BatteryManager bm = (BatteryManager) getSystemService(BATTERY_SERVICE);
        int battery = bm != null ? bm.getIntProperty(BatteryManager.BATTERY_PROPERTY_CAPACITY) : -1;
        uploads.execute(() -> {
            HttpURLConnection conn = null;
            try {
                JSONObject body = new JSONObject();
                body.put("lat", loc.getLatitude());
                body.put("lng", loc.getLongitude());
                if (loc.hasAccuracy()) body.put("accuracy", Math.min(10_000.0, (double) loc.getAccuracy()));
                if (battery >= 0 && battery <= 100) body.put("battery", battery / 100.0);
                body.put("at", loc.getTime());
                conn = (HttpURLConnection) new URL(base + "/api/me/location").openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(20_000);
                conn.setReadTimeout(30_000);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                String cookie = CookieManager.getInstance().getCookie(base);
                if (cookie != null) conn.setRequestProperty("Cookie", cookie);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
                conn.getResponseCode();
            } catch (Exception ignored) {
                // offline: the next fix tries again
            } finally {
                if (conn != null) conn.disconnect();
            }
        });
    }

    private void stopGuard() {
        running = false;
        stopShake();
        stopSharing();
        main.removeCallbacks(tick);
        ServiceCompat.stopForeground(this, ServiceCompat.STOP_FOREGROUND_REMOVE);
        stopSelf();
    }

    @Override
    public void onDestroy() {
        running = false;
        if (sensors != null) sensors.unregisterListener(this);
        if (wakeLock != null && wakeLock.isHeld()) wakeLock.release();
        stopSharing();
        uploads.shutdown();
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
        boolean guard = SosNative.prefs(this).getBoolean("guard", false);
        boolean share = SosNative.prefs(this).getBoolean("shareLive", false);
        String title = guard && share ? "Sharing location · shake to SOS on" : share ? "Sharing your location" : "Shake to SOS is on";
        String text = share
            ? "Your trusted contacts can see where you are." + (guard ? " Shake hard to send SOS." : "") + " Turn off in SafeNav."
            : "Shake your phone hard to alert your trusted contacts, even with the screen locked.";
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_GUARD)
            .setSmallIcon(R.drawable.ic_stat_shield)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setOngoing(true)
            .setPriority(NotificationCompat.PRIORITY_LOW)
            .setContentIntent(openApp());
        if (guard) b.addAction(0, "Turn off shake", serviceAction(ACTION_STOP, 1));
        return b.build();
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
