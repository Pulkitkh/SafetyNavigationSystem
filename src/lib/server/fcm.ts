/**
 * Firebase Cloud Messaging (free) for the SafeNav Android app. A high-priority
 * data message wakes the phone even in Doze, and the app then rings like an
 * alarm, also when the phone is on silent (see SosAlarmService.java).
 *
 * Settings, both copied from the Firebase console (docs/RINGING_ALERTS.md):
 *   FIREBASE_SERVICE_ACCOUNT  the service account key JSON (server sending)
 *   FIREBASE_ANDROID_CONFIG   the app's google-services.json (app registration)
 */
import { createSign } from "node:crypto";

interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
}

function json<T>(raw: string | undefined): T | null {
  if (!raw?.trim()) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    console.error("[fcm] a Firebase setting is not valid JSON");
    return null;
  }
}

function serviceAccount(): ServiceAccount | null {
  const sa = json<ServiceAccount>(process.env.FIREBASE_SERVICE_ACCOUNT);
  return sa?.project_id && sa.client_email && sa.private_key ? sa : null;
}

export function fcmEnabled() {
  return !!serviceAccount() && !!fcmClientConfig();
}

/** What the Android app needs to start Firebase without a google-services.json baked into the APK. */
export function fcmClientConfig(): { apiKey: string; appId: string; projectId: string; senderId: string } | null {
  const g = json<{
    project_info?: { project_id?: string; project_number?: string };
    client?: { client_info?: { mobilesdk_app_id?: string; android_client_info?: { package_name?: string } }; api_key?: { current_key?: string }[] }[];
  }>(process.env.FIREBASE_ANDROID_CONFIG);
  const client = g?.client?.find((c) => c.client_info?.android_client_info?.package_name === "in.safenav.app") ?? g?.client?.[0];
  const apiKey = client?.api_key?.[0]?.current_key;
  const appId = client?.client_info?.mobilesdk_app_id;
  const projectId = g?.project_info?.project_id;
  const senderId = g?.project_info?.project_number;
  return apiKey && appId && projectId && senderId ? { apiKey, appId, projectId, senderId } : null;
}

let cachedToken: { value: string; exp: number } | null = null;

function b64url(v: string | Buffer) {
  return Buffer.from(v).toString("base64url");
}

/** OAuth2 access token for FCM, from a JWT signed with the service account key. */
async function accessToken(sa: ServiceAccount): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.value;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claims = b64url(
    JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }),
  );
  const signature = createSign("RSA-SHA256").update(`${header}.${claims}`).sign(sa.private_key.replace(/\\n/g, "\n"));
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: `${header}.${claims}.${b64url(signature)}` }),
    signal: AbortSignal.timeout(10_000),
  });
  const data = (await res.json().catch(() => ({}))) as { access_token?: string; expires_in?: number; error_description?: string };
  if (!data.access_token) throw new Error(`Firebase auth: ${data.error_description ?? `HTTP ${res.status}`}`);
  cachedToken = { value: data.access_token, exp: now + (data.expires_in ?? 3600) };
  return data.access_token;
}

export function resetFcmForTests() {
  cachedToken = null;
}

/** Sends a data-only, high-priority message. `gone` means the app was uninstalled or the token expired. */
export async function sendFcm(token: string, data: Record<string, string>): Promise<{ ok: boolean; gone?: boolean; error?: string }> {
  const sa = serviceAccount();
  if (!sa) return { ok: false, error: "Firebase not configured" };
  try {
    const res = await fetch(`https://fcm.googleapis.com/v1/projects/${sa.project_id}/messages:send`, {
      method: "POST",
      headers: { Authorization: `Bearer ${await accessToken(sa)}`, "Content-Type": "application/json" },
      body: JSON.stringify({ message: { token, data, android: { priority: "HIGH", ttl: "900s" } } }),
      signal: AbortSignal.timeout(10_000),
    });
    if (res.ok) return { ok: true };
    const body = (await res.json().catch(() => ({}))) as { error?: { message?: string; status?: string; details?: { errorCode?: string }[] } };
    const code = body.error?.details?.find((d) => d.errorCode)?.errorCode ?? body.error?.status;
    return { ok: false, gone: res.status === 404 || code === "UNREGISTERED", error: `FCM: ${body.error?.message ?? `HTTP ${res.status}`}` };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
