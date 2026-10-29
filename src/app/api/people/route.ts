import { json, requireUser, route } from "@/lib/server/http";
import { peopleFor } from "@/lib/server/people";

/** The people who added you as a trusted contact and linked your account. */
export const GET = route(async () => {
  const me = await requireUser();
  return json({ people: await peopleFor(me.id) });
});
