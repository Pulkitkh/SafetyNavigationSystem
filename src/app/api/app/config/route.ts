import { vapidPublicKey } from "@/lib/server/alerts";
import { fcmClientConfig } from "@/lib/server/fcm";
import { json, route } from "@/lib/server/http";

/** Settings the apps need at runtime, so they can change without a new APK. */
export const GET = route(async () => json({ fcm: fcmClientConfig(), vapidPublicKey: vapidPublicKey() }));
