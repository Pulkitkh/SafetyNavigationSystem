# Android and iOS app

SafeNav runs on the web, as an installable PWA, and as a native Android/iOS app built with [Capacitor](https://capacitorjs.com). The native app is a shell that loads your deployed site, so the web and the app always run the same code against the same live data. It adds what browsers can't do:

| | Browser / PWA | Native app |
| --- | --- | --- |
| Safe route planning, SOS, live sharing, reports | ✓ | ✓ |
| GPS with the screen locked during a journey | ✗ (screen must stay on) | ✓ (foreground service with a persistent notification) |
| Location uploads while in the background | Paused | ✓ (native HTTP, not throttled) |
| SOS texts contacts with no tap, even offline | ✗ (opens the SMS app) | ✓ Android (`SEND_SMS`, from the user's SIM) |
| Shake to SOS with the screen locked | ✗ (only while open) | ✓ Android (foreground service, cancellable countdown notification) |
| "Send SOS" from the home-screen icon | – | ✓ Android (long-press the icon) |
| SOS when the site can't load | Cached help page | ✓ Bundled offline page with a confirmed native SOS |
| Store listing | – | Google Play / App Store |

The web code detects the shell (`src/lib/client/native.ts`). During a journey it switches to [`@capacitor-community/background-geolocation`](https://github.com/capacitor-community/background-geolocation). Everywhere else it uses the normal browser APIs.

## Download

Every push to `main` that touches the app builds a signed APK in GitHub Actions (`.github/workflows/android.yml`) and publishes it as the latest release:

https://github.com/Pulkitkh/SafetyNavigationSystem/releases/latest/download/SafeNav.apk

Builds are signed with the key in `android/app/safenav-debug.keystore`, so each new APK installs over the last one. For a Play Store release, add a private key as the secrets `ANDROID_KEYSTORE_BASE64`, `ANDROID_KEYSTORE_PASSWORD`, `ANDROID_KEY_ALIAS` and `ANDROID_KEY_PASSWORD`; the workflow then signs with it instead. Google Play only allows `SEND_SMS` for approved use cases, so a Play listing needs the SMS permission declaration form (emergency alerts) or a build without automatic SMS.

## Native SOS (Android)

`android/app/src/main/java/in/safenav/app/`:

- **`SosSms`** sends SMS through `SmsManager` and reports delivery per number.
- **`SosNative`** runs the whole SOS without the web app: SMS first (works offline), then `POST /api/sos` with the session cookie, so app and Telegram alerts and the live link follow. A location found after the first SMS is texted as a follow-up.
- **`ShakeGuardService`** listens for a hard shake with the screen off. While the app is open it hands the shake to the web app's countdown; otherwise it shows a countdown notification with Cancel and Send now.
- **`SafeNavNativePlugin`** is the bridge the web app uses (`src/lib/client/native.ts`, `src/components/NativeBridge.tsx`): permissions, sending SMS, keeping contacts and settings in sync on the device, and reporting SOS sent while the app was closed.
- **`MainActivity`** handles the "Send SOS" launcher shortcut and the `safenavsos://send` link on the offline page (always with a confirmation, since any web page could link to it).

## Build

Requirements: Node 20+, Android Studio (Android), and Xcode with CocoaPods (iOS, macOS only).

```bash
npm install
CAP_SERVER_URL=https://your-domain npx cap sync    # writes the URL into both native projects
npm run cap:android                                 # opens Android Studio → Run / Build APK
npm run cap:ios                                     # opens Xcode → Run / Archive
```

Run `cap sync` again whenever `CAP_SERVER_URL`, `capacitor.config.ts` or a native plugin changes. The URL must be HTTPS, because location and cookies need a secure origin.

## What is already configured

- **`capacitor.config.ts`:**
  - `android.useLegacyBridge` keeps location updates flowing after 5 minutes in the background.
  - `CapacitorHttp` and `CapacitorCookies` send location uploads natively, so Android doesn't throttle them.
- **Android (`android/app/src/main/AndroidManifest.xml`):** `INTERNET` and `VIBRATE`. The plugin merges in fine/coarse location, `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION` and `POST_NOTIFICATIONS`.
- **iOS (`ios/App/App/Info.plist`):** location "when in use" and "always" usage strings, the motion usage string for shake to SOS, and `UIBackgroundModes: location`.
- **`native/www/index.html`:** an offline page with one-tap emergency numbers, shown if the site can't be reached at launch.

## Before publishing

1. **App identity:** change `appId` (`in.safenav.app`) to a reverse-domain ID you own. Replace the launcher icons in `android/app/src/main/res/mipmap-*` and `ios/App/App/Assets.xcassets`.
2. **Android 13+ notifications:** the background-tracking notification needs the `POST_NOTIFICATIONS` runtime permission. Tracking still runs without it, but the user can't see the notification. Optionally prompt for it with `@capacitor/local-notifications`.
3. **Google Play:** background location requires the [location permissions declaration](https://support.google.com/googleplay/android-developer/answer/9799150). Describe it as journey sharing with trusted contacts, active only while a journey or SOS is running, and include a short video of that flow.
4. **App Store:** Apple can reject apps that are only a website in a wrapper (guideline 4.2). Point reviewers to the native background tracking, and explain why "Always" location is needed in the review notes.
5. **Test on real devices:** start a journey, lock the phone, and walk for 10+ minutes. Then confirm that the live link (`/t/<token>`) kept updating and that off-route and stop check-ins still fire.
