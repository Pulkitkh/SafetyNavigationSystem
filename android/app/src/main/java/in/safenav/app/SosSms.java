package in.safenav.app;

import android.app.Activity;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.telephony.SmsManager;
import androidx.core.content.ContextCompat;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Sends SMS directly from the phone's own SIM, with no app to open and no
 * button to press. Costs only what the user's plan charges for SMS, and works
 * without mobile data, which is why it is the first thing an SOS does.
 */
final class SosSms {

    interface Callback {
        void done(JSONArray results);
    }

    private static final long TIMEOUT_MS = 30_000;

    private SosSms() {}

    static boolean hasPermission(Context ctx) {
        return ContextCompat.checkSelfPermission(ctx, android.Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED;
    }

    static boolean hasTelephony(Context ctx) {
        return ctx.getPackageManager().hasSystemFeature(PackageManager.FEATURE_TELEPHONY_MESSAGING);
    }

    @SuppressWarnings("deprecation")
    private static SmsManager manager(Context ctx) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            SmsManager m = ctx.getSystemService(SmsManager.class);
            if (m != null) return m;
        }
        return SmsManager.getDefault();
    }

    /** Sends `message` to each number; the callback gets one {to, ok, error?} per number, on the main thread. */
    static void send(Context context, List<String> numbers, String message, Callback cb) {
        final Context ctx = context.getApplicationContext();
        final Handler main = new Handler(Looper.getMainLooper());
        final JSONArray results = new JSONArray();
        if (numbers.isEmpty()) {
            main.post(() -> cb.done(results));
            return;
        }
        if (!hasPermission(ctx) || !hasTelephony(ctx)) {
            for (String n : numbers) results.put(result(n, false, hasTelephony(ctx) ? "SMS permission not granted" : "This device can't send SMS"));
            main.post(() -> cb.done(results));
            return;
        }

        final String action = "in.safenav.app.SMS_SENT." + UUID.randomUUID();
        final SmsManager sms = manager(ctx);
        final AtomicInteger pending = new AtomicInteger(numbers.size());
        final AtomicBoolean finished = new AtomicBoolean(false);
        final boolean[] partFailed = new boolean[numbers.size()];
        final int[] partsLeft = new int[numbers.size()];
        final List<BroadcastReceiver> holder = new ArrayList<>();

        final Runnable finish = () -> {
            if (!finished.compareAndSet(false, true)) return;
            try {
                if (!holder.isEmpty()) ctx.unregisterReceiver(holder.get(0));
            } catch (IllegalArgumentException ignored) {
                // already unregistered
            }
            cb.done(results);
        };

        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context c, Intent intent) {
                int i = intent.getIntExtra("index", -1);
                if (i < 0 || i >= numbers.size()) return;
                if (getResultCode() != Activity.RESULT_OK) partFailed[i] = true;
                if (--partsLeft[i] > 0) return;
                synchronized (results) {
                    results.put(result(numbers.get(i), !partFailed[i], partFailed[i] ? errorText(getResultCode()) : null));
                }
                if (pending.decrementAndGet() == 0) finish.run();
            }
        };
        holder.add(receiver);
        ContextCompat.registerReceiver(ctx, receiver, new IntentFilter(action), ContextCompat.RECEIVER_NOT_EXPORTED);

        ArrayList<String> parts = sms.divideMessage(message);
        for (int i = 0; i < numbers.size(); i++) {
            partsLeft[i] = parts.size();
            ArrayList<PendingIntent> sent = new ArrayList<>();
            for (int p = 0; p < parts.size(); p++) {
                Intent intent = new Intent(action).setPackage(ctx.getPackageName()).putExtra("index", i);
                sent.add(PendingIntent.getBroadcast(ctx, i * 100 + p, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));
            }
            try {
                sms.sendMultipartTextMessage(numbers.get(i), null, parts, sent, null);
            } catch (RuntimeException e) {
                synchronized (results) {
                    results.put(result(numbers.get(i), false, e.getMessage() != null ? e.getMessage() : "send failed"));
                }
                partsLeft[i] = 0;
                if (pending.decrementAndGet() == 0) main.post(finish);
            }
        }
        // Radios can sit on a message with no signal; report what we know rather than hang.
        main.postDelayed(() -> {
            synchronized (results) {
                for (int i = 0; i < numbers.size(); i++) {
                    if (partsLeft[i] > 0) results.put(result(numbers.get(i), false, "No signal yet; the phone will keep trying"));
                }
            }
            finish.run();
        }, TIMEOUT_MS);
    }

    private static String errorText(int code) {
        switch (code) {
            case SmsManager.RESULT_ERROR_NO_SERVICE:
                return "No mobile signal";
            case SmsManager.RESULT_ERROR_RADIO_OFF:
                return "Airplane mode is on";
            case SmsManager.RESULT_ERROR_NULL_PDU:
            case SmsManager.RESULT_ERROR_GENERIC_FAILURE:
            default:
                return "SMS failed (code " + code + ")";
        }
    }

    private static JSONObject result(String to, boolean ok, String error) {
        JSONObject o = new JSONObject();
        try {
            o.put("to", to);
            o.put("ok", ok);
            if (error != null) o.put("error", error);
        } catch (JSONException ignored) {
            // keys are constant
        }
        return o;
    }
}
