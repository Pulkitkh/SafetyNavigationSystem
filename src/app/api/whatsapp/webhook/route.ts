import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb, schema } from "@/lib/db";
import { validMetaSignature, whatsappEnabled, whatsappText } from "@/lib/server/alerts";
import { ApiError, json, readLimited, route } from "@/lib/server/http";

interface Update {
  entry?: { changes?: { value?: { messages?: { from?: string; type?: string; text?: { body?: string } }[] } }[] }[];
}

/** Meta's one-time check when the webhook URL is saved in the app dashboard. */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  const expected = process.env.WHATSAPP_VERIFY_TOKEN?.trim();
  if (expected && q.get("hub.mode") === "subscribe" && q.get("hub.verify_token") === expected) {
    return new NextResponse(q.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  return new NextResponse("Forbidden", { status: 403 });
}

/**
 * Messages contacts send to the business number. "STOP" ends WhatsApp alerts
 * for that number; anything else gets a short note on what this number is for.
 */
export const POST = route(async (req: NextRequest) => {
  const secret = process.env.WHATSAPP_APP_SECRET?.trim();
  const raw = await readLimited(req, 256_000);
  // Without the app secret anyone could post fake messages, e.g. to switch someone's alerts off.
  if (!whatsappEnabled() || !secret || !validMetaSignature(raw, req.headers.get("x-hub-signature-256"), secret)) throw new ApiError(403, "Forbidden");
  const update = JSON.parse(raw || "{}") as Update;
  const db = await getDb();
  for (const entry of update.entry ?? []) {
    for (const change of entry.changes ?? []) {
      for (const m of change.value?.messages ?? []) {
        if (!m.from) continue;
        const text = (m.text?.body ?? "").trim().toLowerCase();
        if (/^(stop|unsubscribe|band karo)\b/.test(text)) {
          await db.delete(schema.guardianDevices).where(and(eq(schema.guardianDevices.kind, "whatsapp"), eq(schema.guardianDevices.address, m.from)));
          await whatsappText(m.from, "SafeNav alerts are now off for this number. You won't get SOS messages here any more.").catch(() => {});
        } else {
          await whatsappText(
            m.from,
            "This number only sends SafeNav safety alerts from people who added you as a trusted contact. If you get an SOS, call them, and dial 112 if you can't reach them. Reply STOP to stop alerts.",
          ).catch(() => {});
        }
      }
    }
  }
  return json({ ok: true });
});
