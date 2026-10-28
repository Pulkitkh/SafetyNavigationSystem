# Android and iOS app

SafeNav runs on the web, as an installable PWA, and as a native Android/iOS app built with [Capacitor](https://capacitorjs.com). The native app is a shell that loads your deployed site, so the web and the app always run the same code against the same live data. It adds what browsers can't do:

| | Browser / PWA | Native app |
| --- | --- | --- |
| Safe route planning, SOS, live sharing, reports | ✓ | ✓ |
| GPS with the screen locked during a journey | ✗ (screen must stay on) | ✓ (foreground service with a persistent notification) |
| Location uploads while in the background | Paused | ✓ (native HTTP, not throttled) |
| Store listing | – | Google Play / App Store |

The web code detects the shell (`src/lib/client/native.ts`). During a journey it switches to [`@capacitor-community/background-geolocation`](https://github.com/capacitor-community/background-geolocation). Everywhere else it uses the normal browser APIs.

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
