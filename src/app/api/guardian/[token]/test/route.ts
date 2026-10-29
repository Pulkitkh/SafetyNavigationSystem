import type { NextRequest } from "next/server";
import { alertContacts } from "@/lib/server/alerts";
import { inviteFor } from "@/lib/server/guardian";
import { json, rateLimit, route } from "@/lib/server/http";

type Ctx = { params: Promise<{ token: string }> };

/** Sends a clearly-labelled test alert to every device linked from this invite. */
export const POST = route(async (req: NextRequest, { params }: Ctx) => {
  rateLimit(req, "guardian-test", 5, 10 * 60_000);
  const { token } = await params;
  const { contact, userName } = await inviteFor(token);
  const results = await alertContacts(
    [contact.id],
    {
      kind: "test",
      tripId: "test",
      title: `Test alert from SafeNav`,
      body: `This is only a test. If ${userName} ever presses SOS, you'll get an alert like this with their live location.`,
      url: null,
    },
    { record: false },
  );
  return json({ sent: results.filter((r) => r.ok).length, failed: results.filter((r) => !r.ok).length });
});
