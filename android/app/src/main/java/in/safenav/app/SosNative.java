package in.safenav.app;

import android.Manifest;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.location.Location;
import android.location.LocationManager;
import android.os.CancellationSignal;
import android.os.Handler;
import android.os.Looper;
import android.util.Base64;
import android.webkit.CookieManager;
import androidx.core.content.ContextCompat;
import androidx.core.location.LocationManagerCompat;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.concurrent.Executors;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * The SOS that runs without the web app: from a shake with the screen locked,
 * or from the home-screen shortcut. It texts every trusted contact from the
 * phone's SIM straight away, then tells the server so app and Telegram alerts
 * and the live-tracking link go out too.
 *
 * The web app keeps the settings here up to date (contacts, name, server) so
 * this works even when the server is unreachable.
 */
final class SosNative {

    interface Listener {
        void done(JSONObject outcome);
    }

    static final String PREFS = "safenav.guard";
    private static final long FRESH_FIX_MS = 10 * 60_000;

    private SosNative() {}

    static SharedPreferences prefs(Context ctx) {
        return ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    static String newToken() {
        byte[] b = new byte[16];
        new SecureRandom().nextBytes(b);
        return Base64.encodeToString(b, Base64.URL_SAFE | Base64.NO_PADDING | Base64.NO_WRAP);
    }

    static List<String> phones(Context ctx) {
        List<String> out = new ArrayList<>();
        try {
            JSONArray arr = new JSONArray(prefs(ctx).getString("contacts", "[]"));
            for (int i = 0; i < arr.length(); i++) {
                String p = arr.getJSONObject(i).optString("phone", "");
                if (!p.isEmpty()) out.add(p);
            }
        } catch (JSONException ignored) {
            // corrupt settings: no contacts
        }
        return out;
    }

    static boolean hasLocationPermission(Context ctx) {
        return ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED
            || ContextCompat.checkSelfPermission(ctx, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED;
    }

    /** Best recent location the phone already has, or null. */
    @SuppressWarnings("MissingPermission")
    static Location lastKnown(Context ctx) {
        if (!hasLocationPermission(ctx)) return null;
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        if (lm == null) return null;
        Location best = null;
        for (String p : lm.getProviders(true)) {
            Location l = lm.getLastKnownLocation(p);
            if (l == null) continue;
            if (best == null || l.getTime() > best.getTime() + 60_000 || (Math.abs(l.getTime() - best.getTime()) < 60_000 && l.getAccuracy() < best.getAccuracy())) best = l;
        }
        if (best != null && System.currentTimeMillis() - best.getTime() > FRESH_FIX_MS) return null;
        return best;
    }

    /** A fresh fix, or null after `timeoutMs`. */
    @SuppressWarnings("MissingPermission")
    static void currentLocation(Context ctx, long timeoutMs, androidx.core.util.Consumer<Location> cb) {
        Handler main = new Handler(Looper.getMainLooper());
        if (!hasLocationPermission(ctx)) {
            main.post(() -> cb.accept(null));
            return;
        }
        LocationManager lm = (LocationManager) ctx.getSystemService(Context.LOCATION_SERVICE);
        String provider = lm != null && lm.isProviderEnabled(LocationManager.GPS_PROVIDER) ? LocationManager.GPS_PROVIDER : LocationManager.NETWORK_PROVIDER;
        if (lm == null || !lm.isProviderEnabled(provider)) {
            main.post(() -> cb.accept(null));
            return;
        }
        CancellationSignal cancel = new CancellationSignal();
        final boolean[] answered = { false };
        main.postDelayed(() -> {
            if (answered[0]) return;
            answered[0] = true;
            cancel.cancel();
            cb.accept(null);
        }, timeoutMs);
        LocationManagerCompat.getCurrentLocation(lm, provider, cancel, ContextCompat.getMainExecutor(ctx), (loc) -> {
            if (answered[0]) return;
            answered[0] = true;
            cb.accept(loc);
        });
    }

    static String message(Context ctx, Location loc, String liveUrl) {
        SharedPreferences p = prefs(ctx);
        String name = p.getString("name", "");
        StringBuilder sb = new StringBuilder();
        sb.append("SOS: ").append(name.isEmpty() ? "Your contact" : name).append(" needs help.\n");
        if (loc != null) {
            sb.append("Location");
            if (loc.hasAccuracy()) sb.append(" ±").append(Math.round(loc.getAccuracy())).append("m");
            sb.append(": ").append(mapsLink(loc)).append("\n");
        } else {
            sb.append("Location not available yet.\n");
        }
        if (liveUrl != null) sb.append("Live tracking: ").append(liveUrl).append("\n");
        sb.append("Call them now. If unreachable, dial 112.");
        return sb.toString();
    }

    static String mapsLink(Location loc) {
        return String.format(Locale.US, "https://maps.google.com/?q=%.6f,%.6f", loc.getLatitude(), loc.getLongitude());
    }

    /**
     * The whole native SOS: SMS first (works offline), then the server. A
     * location found after the first SMS is sent as a short follow-up.
     */
    static void run(Context context, String trigger, Listener listener) {
        final Context ctx = context.getApplicationContext();
        final SharedPreferences p = prefs(ctx);
        final String base = p.getString("baseUrl", "");
        final boolean signedIn = p.getBoolean("signedIn", false);
        final String token = newToken();
        final String liveUrl = signedIn && !base.isEmpty() ? base + "/t/" + token : null;
        final List<String> numbers = phones(ctx);
        final Location known = lastKnown(ctx);

        final JSONObject outcome = new JSONObject();
        try {
            outcome.put("token", token);
            outcome.put("trigger", trigger);
            outcome.put("at", System.currentTimeMillis());
            if (liveUrl != null) outcome.put("liveUrl", liveUrl);
        } catch (JSONException ignored) {
            // constant keys
        }

        final boolean autoSms = p.getBoolean("autoSms", true);
        Runnable afterSms = () -> {
            if (known != null) {
                postSos(ctx, base, token, known, trigger, outcome, listener);
            } else {
                // No usable fix: wait briefly for one so the server and follow-up SMS have a location.
                currentLocation(ctx, 15_000, (loc) -> {
                    if (loc != null && autoSms && !numbers.isEmpty()) {
                        SosSms.send(ctx, numbers, "SOS location update: " + mapsLink(loc), (r) -> {});
                    }
                    postSos(ctx, base, token, loc, trigger, outcome, listener);
                });
            }
        };

        if (autoSms && !numbers.isEmpty()) {
            SosSms.send(ctx, numbers, message(ctx, known, liveUrl), (results) -> {
                try {
                    outcome.put("sms", results);
                } catch (JSONException ignored) {
                    // constant keys
                }
                afterSms.run();
            });
        } else {
            afterSms.run();
        }
    }

    private static String readAll(InputStream in) throws java.io.IOException {
        if (in == null) return "";
        try (InputStream is = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            int n;
            while ((n = is.read(buf)) > 0) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }

    private static void postSos(Context ctx, String base, String token, Location loc, String trigger, JSONObject outcome, Listener listener) {
        Handler main = new Handler(Looper.getMainLooper());
        if (base.isEmpty() || !prefs(ctx).getBoolean("signedIn", false)) {
            main.post(() -> listener.done(outcome));
            return;
        }
        Executors.newSingleThreadExecutor().execute(() -> {
            HttpURLConnection conn = null;
            try {
                JSONObject body = new JSONObject();
                body.put("shareToken", token);
                body.put("trigger", "manual");
                if (loc != null) {
                    body.put("lat", loc.getLatitude());
                    body.put("lng", loc.getLongitude());
                    if (loc.hasAccuracy()) body.put("accuracy", (double) loc.getAccuracy());
                }
                String tripId = prefs(ctx).getString("tripId", "");
                if (!tripId.isEmpty()) body.put("tripId", tripId);
                conn = (HttpURLConnection) new URL(base + "/api/sos").openConnection();
                conn.setRequestMethod("POST");
                conn.setConnectTimeout(20_000);
                // A free server may be waking up; give it time.
                conn.setReadTimeout(60_000);
                conn.setDoOutput(true);
                conn.setRequestProperty("Content-Type", "application/json");
                String cookie = CookieManager.getInstance().getCookie(base);
                if (cookie != null) conn.setRequestProperty("Cookie", cookie);
                try (OutputStream os = conn.getOutputStream()) {
                    os.write(body.toString().getBytes(StandardCharsets.UTF_8));
                }
                int code = conn.getResponseCode();
                String text = readAll(code < 400 ? conn.getInputStream() : conn.getErrorStream());
                outcome.put("server", code < 400 ? "ok" : "failed");
                if (code < 400) {
                    JSONObject res = new JSONObject(text);
                    outcome.put("tripId", res.optString("tripId"));
                    outcome.put("reach", res.optJSONArray("reach"));
                } else {
                    outcome.put("serverError", "HTTP " + code);
                }
            } catch (Exception e) {
                try {
                    outcome.put("server", "failed");
                    outcome.put("serverError", e.getMessage() != null ? e.getMessage() : "network error");
                } catch (JSONException ignored) {
                    // constant keys
                }
            } finally {
                if (conn != null) conn.disconnect();
            }
            main.post(() -> listener.done(outcome));
        });
    }
}
