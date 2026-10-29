"use client";

import { Eye, EyeOff } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { Callout, Toggle } from "@/components/ui";
import { api } from "@/lib/client/api";
import { useSession } from "@/lib/client/hooks";
import { nativeSos } from "@/lib/client/native";

/**
 * Always-on location sharing. Off by default; when on, trusted contacts who use
 * SafeNav (and accepted your invite) see where you are at any time.
 */
export function ShareLiveCard() {
  const { me, contacts, refresh } = useSession();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!me) return null;
  const viewers = contacts.filter((c) => c.guardianUserId);

  const set = async (on: boolean) => {
    setBusy(true);
    setError(null);
    try {
      if (on) {
        // Make sure location is allowed now, while the user is looking at the screen.
        await new Promise<void>((resolve) => navigator.geolocation?.getCurrentPosition(() => resolve(), () => resolve(), { timeout: 10_000 }) ?? resolve());
      }
      await api("/api/auth/me", { method: "PATCH", json: { shareLive: on } });
      await nativeSos()
        ?.configure({ shareLive: on })
        .catch(() => {});
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className={`card overflow-hidden ${me.shareLive ? "ring-2 ring-good" : ""}`} aria-labelledby="share-live-title">
      <Toggle
        icon={me.shareLive ? Eye : EyeOff}
        tone={me.shareLive ? "good" : "neutral"}
        label="Share my live location"
        description={
          me.shareLive
            ? viewers.length
              ? `${viewers.map((c) => c.name.split(" ")[0]).join(", ")} can see where you are, at any time.`
              : "On. Contacts who accept your invite in the SafeNav app will see where you are."
            : "Let trusted contacts who use SafeNav see where you are at any time, not only during journeys and SOS."
        }
        checked={me.shareLive}
        onChange={(v) => void set(v)}
        disabled={busy}
      />
      {me.shareLive && viewers.length === 0 && (
        <p className="border-t border-line px-4 py-3 text-sm text-ink-2">
          Nobody can see it yet.{" "}
          <Link href="/contacts" className="font-bold text-brand-ink underline">
            Send your contacts their invite
          </Link>{" "}
          and ask them to tap &ldquo;Add to my People&rdquo;.
        </p>
      )}
      {error && (
        <div className="px-4 pb-3">
          <Callout tone="danger">{error}</Callout>
        </div>
      )}
      <p id="share-live-title" className="sr-only">
        Always-on location sharing
      </p>
    </section>
  );
}
