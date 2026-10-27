/**
 * Optional automatic SMS. With no provider configured the app falls back to the
 * phone's own SMS composer, which costs nothing and works without mobile data.
 *
 * India requires DLT (TRAI) registration for application-to-person SMS: the
 * sender ID and message template must be approved on a DLT portal first.
 */
export interface SmsResult {
  to: string;
  ok: boolean;
  error?: string;
}

export interface SmsProvider {
  name: string;
  send(to: string[], body: string, vars: { name: string; link: string; place: string }): Promise<SmsResult[]>;
}

const twilio: SmsProvider = {
  name: "twilio",
  async send(to, body) {
    const sid = process.env.TWILIO_ACCOUNT_SID!;
    const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString("base64");
    return Promise.all(
      to.map(async (number) => {
        try {
          const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
            method: "POST",
            headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: new URLSearchParams({ To: number, From: process.env.TWILIO_FROM_NUMBER!, Body: body }),
            signal: AbortSignal.timeout(10_000),
          });
          if (res.ok) return { to: number, ok: true };
          const data = (await res.json().catch(() => ({}))) as { message?: string };
          return { to: number, ok: false, error: data.message ?? `HTTP ${res.status}` };
        } catch (err) {
          return { to: number, ok: false, error: (err as Error).message };
        }
      }),
    );
  },
};

const msg91: SmsProvider = {
  name: "msg91",
  async send(to, _body, vars) {
    try {
      const res = await fetch("https://control.msg91.com/api/v5/flow", {
        method: "POST",
        headers: { authkey: process.env.MSG91_AUTH_KEY!, "Content-Type": "application/json", accept: "application/json" },
        body: JSON.stringify({
          template_id: process.env.MSG91_TEMPLATE_ID,
          short_url: "0",
          recipients: to.map((n) => ({ mobiles: n.replace(/^\+/, ""), ...vars })),
        }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json().catch(() => ({}))) as { type?: string; message?: string };
      const ok = res.ok && data.type !== "error";
      return to.map((n) => ({ to: n, ok, error: ok ? undefined : (data.message ?? `HTTP ${res.status}`) }));
    } catch (err) {
      return to.map((n) => ({ to: n, ok: false, error: (err as Error).message }));
    }
  },
};

export function smsProvider(): SmsProvider | null {
  const name = process.env.SMS_PROVIDER?.toLowerCase();
  if (name === "twilio" && process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) return twilio;
  if (name === "msg91" && process.env.MSG91_AUTH_KEY && process.env.MSG91_TEMPLATE_ID) return msg91;
  return null;
}
