import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { ensureTelegramWebhook, telegramBotName, vapidPublicKey, whatsappEnabled } from "@/lib/server/alerts";
import { currentUser } from "@/lib/server/auth";
import { inviteFor } from "@/lib/server/guardian";
import { json, rateLimit, route } from "@/lib/server/http";
import { appUrl } from "@/lib/server/url";

type Ctx = { params: Promise<{ token: string }> };

/** What the invite page needs: who invited whom, and which alert channels are available. */
export const GET = route(async (req: NextRequest, { params }: Ctx) => {
  rateLimit(req, "guardian", 60, 60_000);
  const { token } = await params;
  const { contact, userName } = await inviteFor(token);
  const db = await getDb();
  const devices = await db.select({ kind: schema.guardianDevices.kind }).from(schema.guardianDevices).where(eq(schema.guardianDevices.contactId, contact.id));
  await ensureTelegramWebhook(appUrl(req));
  const bot = await telegramBotName();
  const viewer = await currentUser();
  return json({
    userName,
    contactName: contact.name,
    vapidPublicKey: vapidPublicKey(),
    telegram: bot ? `https://t.me/${bot}?start=${token}` : null,
    // WhatsApp alerts go to the number the inviter saved; shown so the contact can check it's theirs.
    whatsapp: whatsappEnabled() ? { number: contact.phone } : null,
    // Linking a SafeNav account adds this person to the contact's People page.
    account: {
      signedIn: !!viewer,
      isInviter: viewer?.id === contact.userId,
      linkedToYou: !!viewer && contact.guardianUserId === viewer.id,
      linkedElsewhere: !!contact.guardianUserId && contact.guardianUserId !== viewer?.id,
    },
    linked: {
      push: devices.filter((d) => d.kind === "push").length,
      telegram: devices.filter((d) => d.kind === "telegram").length,
      whatsapp: devices.filter((d) => d.kind === "whatsapp").length,
    },
  });
});
