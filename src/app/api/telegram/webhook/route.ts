import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/server/auth";
import { telegramEnabled, telegramMessage, telegramWebhookSecret } from "@/lib/server/alerts";
import { inviteFor } from "@/lib/server/guardian";
import { ApiError, json, readLimited, route } from "@/lib/server/http";

interface Update {
  message?: { text?: string; chat?: { id?: number; type?: string; first_name?: string } };
}

/**
 * Telegram bot webhook. A contact taps the t.me link on their invite page,
 * which sends "/start <invite token>"; from then on SOS alerts reach that chat.
 */
export const POST = route(async (req: NextRequest) => {
  if (!telegramEnabled() || req.headers.get("x-telegram-bot-api-secret-token") !== telegramWebhookSecret()) throw new ApiError(403, "Forbidden");
  const update = JSON.parse((await readLimited(req, 64_000)) || "{}") as Update;
  const chatId = update.message?.chat?.id;
  const text = update.message?.text?.trim() ?? "";
  if (!chatId || update.message?.chat?.type !== "private") return json({ ok: true });
  const chat = String(chatId);
  const db = await getDb();

  if (text.startsWith("/start")) {
    const token = text.split(/\s+/)[1];
    if (!token) {
      await telegramMessage(chat, "Hi! To get SOS alerts, open the invite link your contact sent you and tap \"Get alerts on Telegram\".");
      return json({ ok: true });
    }
    try {
      const { contact, userName } = await inviteFor(token);
      const exists = await db.query.guardianDevices.findFirst({
        where: and(eq(schema.guardianDevices.contactId, contact.id), eq(schema.guardianDevices.kind, "telegram"), eq(schema.guardianDevices.address, chat)),
      });
      if (!exists) {
        await db.insert(schema.guardianDevices).values({ id: newId(), contactId: contact.id, kind: "telegram", address: chat, label: "Telegram" });
      }
      await telegramMessage(
        chat,
        `You're now a trusted contact for ${userName}. If they press SOS, you'll get a message here at once with their live location.\n\nKeep notifications for this chat turned on. Send /stop to stop alerts.`,
      );
    } catch {
      await telegramMessage(chat, "That invite link is no longer valid. Ask for a new one from the SafeNav app.");
    }
    return json({ ok: true });
  }

  if (text === "/stop") {
    await db.delete(schema.guardianDevices).where(and(eq(schema.guardianDevices.kind, "telegram"), eq(schema.guardianDevices.address, chat)));
    await telegramMessage(chat, "Alerts stopped. You won't get SOS messages here any more.");
  }
  return json({ ok: true });
});
