# Alerts when the phone is off, locked or has SafeNav closed

A browser stops running a web app soon after it leaves the screen: no GPS, no
timers, no shake detection. The installed web app (added from Chrome) is still
a browser page, so it has the same limits. SafeNav covers this in three ways.

## 1. The server watchdog

The server keeps a copy of everything it needs to act without the phone, and
checks every 30 seconds (`src/lib/server/watchdog.ts`):

| Situation | What happens |
| --- | --- |
| Safety timer runs out | "Are you OK?" to your own phone. No answer 60 s + 90 s later: SOS to every contact, with your last shared location. |
| Journey: no location for 4 min | "Your journey isn't being shared, open SafeNav" to your own phone. |
| Journey: no location for 15 min | Contacts get "Lost touch with …", with the last known location and the live link. When the phone reports again they get "… is sharing again". |
| Journey overdue (app's grace + 5 min) | "Are you OK?" to your own phone. No answer in 5 min: SOS (Automatic SOS on) or "… hasn't arrived yet" (off). Tapping I'm OK in the app resets it. |

Every step is claimed with a conditional update, so overlapping passes never
send it twice. Links the server sends use a share token it derives from the
trip id (`SHARE_TOKEN_SECRET`, or a key derived from `VAPID_PRIVATE_KEY`),
since it only stores the hash of the token the phone made.

The SOS the server raises goes through the same `raiseSos()` as the SOS
button: app alarms, Web Push, Telegram, WhatsApp and a paid SMS gateway if one
is configured. Only the SMS from the phone's own SIM needs the phone.

## 2. Alerts on your own phone with the app closed

In a browser or the installed web app, **Turn on alerts** (Safety, Account,
People) links this browser's Web Push subscription to your account
(`app_devices`, platform `web`). Then SOS from people you protect, and the
watchdog's "Are you OK?", arrive as notifications with SafeNav closed. The
Android app does this through Firebase instead (docs/RINGING_ALERTS.md).

## 3. Keeping a free server awake

A free Render web service sleeps after 15 minutes without requests, and a
sleeping server runs no watchdog. An outside scheduler calls
`POST /api/cron/watchdog` every minute with the `x-cron-secret` header, which
runs a pass and keeps the server awake (one always-on free service fits in
Render's 750 free hours a month). With Supabase:

```sql
create extension if not exists pg_cron;
create extension if not exists pg_net schema extensions;
select vault.create_secret('<CRON_SECRET>', 'safenav_cron_secret');
select cron.schedule('safenav-watchdog', '* * * * *', $$
  select net.http_post(
    url := 'https://<your-app>.onrender.com/api/cron/watchdog',
    headers := jsonb_build_object('x-cron-secret',
      (select decrypted_secret from vault.decrypted_secrets where name = 'safenav_cron_secret')),
    timeout_milliseconds := 60000
  );
$$);
```

Any other scheduler that can send a POST with a header works too (GitHub
Actions, cron-job.org).

## What still needs the Android app

Tracking your location with the screen locked, shake to SOS in a pocket, and
SMS from your own SIM all need code running on the phone, which only the
native app can do (docs/NATIVE_APP.md). Everything above works without it.
