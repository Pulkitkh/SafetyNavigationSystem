import type { NextRequest } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { whatsappEnabled } from "@/lib/server/alerts";
import { newId } from "@/lib/server/auth";
import { inviteFor } from "@/lib/server/guardian";
import { ApiError, json, parseBody, rateLimit, route } from "@/lib/server/http";

type Ctx = { params: Promise<{ token: string }> };

const optIn = z.object({ consent: z.literal(true) });

/**
 * The contact agrees, on their own invite page, to get alerts on WhatsApp at
 * the number the inviter saved for them. WhatsApp requires this opt-in before
 * a business number may message someone.
 */
export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  rateLimit(req, "guardian-wa", 10, 60 * 60_000);
  if (!whatsappEnabled()) throw new ApiError(404, "WhatsApp alerts aren't set up on this server");
  const { token } = await params;
  const { contact } = await inviteFor(token);
  await parseBody(req, optIn);
  const address = contact.phone.replace(/\D/g, "");
  const db = await getDb();
  const exists = await db.query.guardianDevices.findFirst({
    where: and(eq(schema.guardianDevices.contactId, contact.id), eq(schema.guardianDevices.kind, "whatsapp")),
  });
  if (exists) {
    await db.update(schema.guardianDevices).set({ address, failures: 0 }).where(eq(schema.guardianDevices.id, exists.id));
    return json({ ok: true, number: contact.phone });
  }
  await db.insert(schema.guardianDevices).values({ id: newId(), contactId: contact.id, kind: "whatsapp", address, label: "WhatsApp" });
  return json({ ok: true, number: contact.phone }, 201);
});

export const DELETE = route(async (_req: NextRequest, { params }: Ctx) => {
  const { token } = await params;
  const { contact } = await inviteFor(token);
  const db = await getDb();
  await db.delete(schema.guardianDevices).where(and(eq(schema.guardianDevices.contactId, contact.id), eq(schema.guardianDevices.kind, "whatsapp")));
  return json({ ok: true });
});
