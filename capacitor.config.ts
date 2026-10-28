import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Native Android/iOS shell around the deployed web app. The shell loads the live
 * site (CAP_SERVER_URL), so web and app always run the same code and data; the
 * native layer adds background GPS during journeys.
 *
 *   CAP_SERVER_URL=https://your-domain npx cap sync
 */
const serverUrl = process.env.CAP_SERVER_URL || process.env.APP_URL;

const config: CapacitorConfig = {
  appId: "in.safenav.app",
  appName: "SafeNav",
  // Shown only if the site can't be reached when the app starts.
  webDir: "native/www",
  server: serverUrl ? { url: serverUrl, cleartext: serverUrl.startsWith("http://") } : undefined,
  android: {
    // Keeps location updates flowing after 5 minutes in the background.
    useLegacyBridge: true,
  },
  plugins: {
    // Native HTTP, so location uploads aren't throttled while the WebView is in the background.
    CapacitorHttp: { enabled: true },
    CapacitorCookies: { enabled: true },
  },
};

export default config;
