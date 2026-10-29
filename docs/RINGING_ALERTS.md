# Ringing SOS alarms on contacts' phones

When someone presses SOS, trusted contacts who use the SafeNav Android app (and
accepted the invite with their account) get an alarm, not just a notification:

- the phone's alarm sound, looping, on the **alarm volume**, so it plays even
  when the phone is on silent or vibrate;
- strong repeating vibration;
- a full-screen alert over the lock screen (where Android allows it) with
  **Open live location** and **Silence**;
- it rings until they act, or for 3 minutes at most, and stops by itself when
  the person marks themselves safe.

Contacts who haven't opened the SOS or answered it are alerted again after 45 s,
90 s and 3 min. That repeat uses only the free channels (app and browser
notifications).

Waking a sleeping Android phone reliably needs **Firebase Cloud Messaging**
(free, by Google). Without it, everything else still works: browser
notifications, WhatsApp/Telegram if configured, and a full-screen alarm inside
SafeNav whenever it's open.

## One-time setup (about 10 minutes)

1. Go to [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (Analytics not needed).
2. **Add app → Android**, package name `in.safenav.app`. Download **google-services.json**. You can skip the "add SDK" steps; the app is already set up.
3. **Project settings → Service accounts → Generate new private key**. This downloads a JSON key. Keep it private.
4. On Render → Environment, add:

   | Variable | Value |
   | --- | --- |
   | `FIREBASE_ANDROID_CONFIG` | the whole contents of `google-services.json` |
   | `FIREBASE_SERVICE_ACCOUNT` | the whole contents of the private key JSON |

`/api/health` then shows "SOS ringing in the app (Firebase): configured". No new
APK is needed: the app reads these settings from the server and registers each
signed-in phone automatically.

## How contacts turn it on

1. Install the SafeNav Android app and sign in (or create an account).
2. Open the invite link you sent them and tap **Add … to my People**.
3. Allow notifications when Android asks. On Android 14, if the alert doesn't
   cover the lock screen, enable *Settings → Apps → SafeNav → Full screen
   notifications*.
