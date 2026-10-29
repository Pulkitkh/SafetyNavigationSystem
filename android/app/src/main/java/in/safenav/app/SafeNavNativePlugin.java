package in.safenav.app;

import android.Manifest;
import android.os.Build;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;
import java.util.List;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * SOS features the browser can't offer, for the web app running inside the
 * Android shell: sending SMS with no tap, and shake-to-SOS with the screen off.
 */
@CapacitorPlugin(
    name = "SafeNavNative",
    permissions = {
        @Permission(strings = { Manifest.permission.SEND_SMS }, alias = "sms"),
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications"),
    }
)
public class SafeNavNativePlugin extends Plugin {

    private static SafeNavNativePlugin instance;
    private static volatile boolean resumed = false;

    @Override
    public void load() {
        instance = this;
        resumed = true;
    }

    @Override
    protected void handleOnResume() {
        resumed = true;
    }

    @Override
    protected void handleOnPause() {
        resumed = false;
    }

    /** Hands a shake to the open app; false if the app isn't on screen to handle it. */
    static boolean emitShake() {
        SafeNavNativePlugin p = instance;
        if (p == null || !resumed || !p.hasListeners("shake")) return false;
        p.notifyListeners("shake", new JSObject());
        return true;
    }

    /** Tells the app about an SOS the native side already sent; kept until the app reads it. */
    static void emitNativeSos(JSONObject outcome) {
        SafeNavNativePlugin p = instance;
        if (p == null) return;
        try {
            p.notifyListeners("nativeSos", JSObject.fromJSONObject(outcome), true);
        } catch (JSONException ignored) {
            // outcome is built by us
        }
    }

    private JSObject status() {
        JSObject o = new JSObject();
        o.put("canSendSms", SosSms.hasTelephony(getContext()));
        o.put("sms", getPermissionState("sms").toString().toLowerCase());
        o.put("notifications", Build.VERSION.SDK_INT >= 33 ? getPermissionState("notifications").toString().toLowerCase() : "granted");
        o.put("guardEnabled", SosNative.prefs(getContext()).getBoolean("guard", false));
        o.put("guardRunning", ShakeGuardService.running);
        o.put("autoSms", SosNative.prefs(getContext()).getBoolean("autoSms", true));
        return o;
    }

    @PluginMethod
    public void getStatus(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void requestSmsPermission(PluginCall call) {
        if (getPermissionState("sms") == PermissionState.GRANTED) call.resolve(status());
        else requestPermissionForAlias("sms", call, "permissionCallback");
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < 33 || getPermissionState("notifications") == PermissionState.GRANTED) call.resolve(status());
        else requestPermissionForAlias("notifications", call, "permissionCallback");
    }

    @PermissionCallback
    private void permissionCallback(PluginCall call) {
        call.resolve(status());
    }

    @PluginMethod
    public void sendSms(PluginCall call) {
        JSArray arr = call.getArray("numbers");
        String message = call.getString("message", "");
        List<String> numbers = new ArrayList<>();
        try {
            if (arr != null) for (Object n : arr.toList()) if (n instanceof String && !((String) n).isEmpty()) numbers.add((String) n);
        } catch (JSONException e) {
            call.reject("numbers must be an array of strings");
            return;
        }
        SosSms.send(getContext(), numbers, message, (results) -> {
            JSObject ret = new JSObject();
            ret.put("results", results);
            call.resolve(ret);
        });
    }

    /** Keeps what the native SOS needs on the device, so it works with the app closed or offline. */
    @PluginMethod
    public void configure(PluginCall call) {
        android.content.SharedPreferences.Editor e = SosNative.prefs(getContext()).edit();
        if (call.hasOption("name")) e.putString("name", call.getString("name", ""));
        if (call.hasOption("baseUrl")) e.putString("baseUrl", call.getString("baseUrl", ""));
        if (call.hasOption("signedIn")) e.putBoolean("signedIn", Boolean.TRUE.equals(call.getBoolean("signedIn", false)));
        if (call.hasOption("contacts")) {
            JSArray c = call.getArray("contacts");
            e.putString("contacts", c != null ? c.toString() : "[]");
        }
        if (call.hasOption("countdownS")) e.putInt("countdownS", call.getInt("countdownS", 5));
        if (call.hasOption("autoSms")) e.putBoolean("autoSms", Boolean.TRUE.equals(call.getBoolean("autoSms", true)));
        if (call.hasOption("tripId")) e.putString("tripId", call.getString("tripId", ""));
        e.apply();
        call.resolve(status());
    }

    @PluginMethod
    public void setShakeGuard(PluginCall call) {
        boolean on = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        SosNative.prefs(getContext()).edit().putBoolean("guard", on).apply();
        try {
            if (on) ShakeGuardService.start(getContext());
            else if (ShakeGuardService.running) ShakeGuardService.stop(getContext());
        } catch (RuntimeException ex) {
            call.reject("Couldn't start shake detection: " + ex.getMessage());
            return;
        }
        call.resolve(status());
    }

    /** An SOS sent natively while the app was closed, so the app can show it and keep sharing location. */
    @PluginMethod
    public void takePendingSos(PluginCall call) {
        String raw = SosNative.prefs(getContext()).getString("pendingSos", null);
        SosNative.prefs(getContext()).edit().remove("pendingSos").apply();
        JSObject ret = new JSObject();
        try {
            ret.put("sos", raw != null ? JSObject.fromJSONObject(new JSONObject(raw)) : null);
        } catch (JSONException e) {
            ret.put("sos", null);
        }
        call.resolve(ret);
    }
}
