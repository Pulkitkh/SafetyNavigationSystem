# SafeNav: Safety Navigation System

SafeNav is a mobile-first web app (installable PWA) for getting around Indian cities safely. It:

- **Finds the safest walking route.** Every 100 m of a route is scored from real OpenStreetMap data: street lighting, footpaths, shops that are actually open at the hour you'll pass, homes and shops facing the street (not blank walls or warehouses), fast multi-lane roads, isolated land such as industrial estates and parks at night, back lanes, and distance to police stations and hospitals. It also uses community reports, the real sun position at your location and the **weather forecast for the hour you travel** (rain empties streets, fog dims lighting, downpours flood underpasses).
- **Finds places other apps miss.** Search as you type, or press Enter for a full search of all of OpenStreetMap. Paste coordinates, a Google Maps or WhatsApp location link, or a Google plus code (`PV93+CR Indore`), or tap **Choose on map**. Results are filtered to India, ranked by name match, spelling variants and distance, and recent and starred places are kept on the phone.
- **"Is it safe here right now?"** A live check of the streets around you, or any spot you tap: lighting, open places, homes facing the street, isolation, police distance and reports. It lists safe spots open now, with a safety-scored route to each.
- **Safety timer.** Set a check-in time for a walk, a date or a wait. If you don't check in, SafeNav asks "Are you OK?" and sends SOS after 60 seconds.
- **Step-free routes** for wheelchair users, older people, and anyone with a walker or stroller. Steps, unpaved and rough surfaces, and ways mapped as inaccessible are avoided, using a dedicated wheelchair routing profile.
- **Voice turn-by-turn directions**, so your phone can stay in a pocket or bag. If you leave the route, **"Find a safe route from here"** re-plans with full safety scoring and updates your contacts' live view.
- **Shares journeys live.** Trusted contacts get a link that shows your position, route, battery and status. No app or account is needed to view it.
- **Monitors cab and auto rides.** It records the number plate, then watches for detours, long unexplained stops and late arrival.
- **Checks in, then escalates.** If you leave the route, stop for too long or run late, it asks "Are you OK?". If you don't answer within 60 seconds, it raises an SOS automatically.
- **Sends SOS automatically, the moment you need it.** Hold the red SOS button for one second (or shake the phone) and, with nothing more to tap:
  - every trusted contact who opened their one-time invite link gets an instant alert on their phone (free Web Push), on WhatsApp (Meta's official Cloud API, [setup](docs/WHATSAPP.md)) or on Telegram, with your live location;
  - in the Android app, an SMS goes to every contact straight from your SIM, even with no internet;
  - the SOS screen shows who was reached, over which channel, and who has opened your alert.

  One-tap SMS and WhatsApp, a call to 112, a loud alarm and a **practice mode** that sends nothing are on the same screen. A paid SMS gateway (Twilio or MSG91) is optional.
- **Takes crowdsourced reports.** Harassment, snatching, poor lighting, stray dogs and more. Reports fade over time, gain weight when others confirm them, and are hidden when flagged.
- **Shake to SOS** (opt-in): shaking the phone hard sends SOS, after a countdown you choose (instant, 3, 5 or 10 s). In the Android app it works with the screen locked.
- **People I protect.** Contacts who accept your invite with their own SafeNav account see you on their People page: your journeys, an SOS the moment you raise it (full screen, with an alarm), and your live location at any time if you turn on **Share my live location**. They can answer "I'm on my way", which you see on your SOS screen. In the Android app the alarm rings even with the phone on silent ([setup](docs/RINGING_ALERTS.md)).
- **Safety setup checklist** that walks new users through contacts, instant alerts, location, shake to SOS and a practice SOS.
- **Light and dark themes**, large touch targets, visible focus and WCAG AA contrast throughout.
- **Fake incoming call** with a ringtone, vibration and a voice on the line, for leaving an uncomfortable situation.
- **Shows nearby help and emergency numbers.** The nearest police stations, hospitals and 24-hour pharmacies, each with a one-tap safe route, plus India's emergency numbers (112, 1091, 181, 108, 1098, 1930).
- **Web, PWA and native app.** One codebase runs in any browser, installs as a PWA, and ships as an Android app that keeps tracking with the screen locked, texts contacts automatically and offers "Send SOS" from the home-screen icon. Every push to `main` builds the APK: [download the latest](https://github.com/Pulkitkh/SafetyNavigationSystem/releases/latest/download/SafeNav.apk). See [docs/NATIVE_APP.md](docs/NATIVE_APP.md).

## Why a PWA

| Need | How the PWA covers it |
| --- | --- |
| Works on any Android or iPhone without an app store | Installs from the browser ("Add to Home screen") |
| SOS without mobile data | `sms:` links open the phone's own SMS app with the message filled in |
| GPS during a journey | `watchPosition` plus the Screen Wake Lock API keeps tracking while the app is open |
| Guardians without the app | The live link is an ordinary web page |
| Low cost | Only free, open data services; automatic SMS is optional |

Known limit: browsers pause location when the screen is locked or the app is in the background, so the journey screen keeps the display on. The native Android/iOS app (Capacitor, in `android/` and `ios/`) removes this limit with background GPS. See [docs/NATIVE_APP.md](docs/NATIVE_APP.md).

## Data sources (all real, all free)

| Data | Service | Used for |
| --- | --- | --- |
| Roads, lights, footpaths, shops, opening hours, land use, police, hospitals, transit, CCTV | OpenStreetMap via [Overpass API](https://overpass-api.de) | Safety factors (richest source) |
| Roads, footpaths, steps, places, buildings, land use | OpenStreetMap [vector tiles](https://openmaptiles.org/schema/) from [OpenFreeMap](https://openfreemap.org) | Safety factors when Overpass is slow or blocked (no street lamps or opening hours, so confidence is lower) |
| Walking and driving routes with alternatives | [OSRM](https://project-osrm.org) on routing.openstreetmap.de (car also on router.project-osrm.org) | Routes and turn-by-turn steps |
| Fallback and wheelchair routing | [Valhalla](https://valhalla.github.io/valhalla/) on valhalla1.openstreetmap.de | When OSRM is down; step-free routes |
| Place search (autocomplete) | [Photon](https://photon.komoot.io) | Search as you type |
| Full search, reverse geocoding | [Nominatim](https://nominatim.org) | Explicit searches (Enter / "Search all places"), names for map taps and links. Throttled to 1 request per second, never used for autocomplete, per its policy |
| Extra place search (optional) | [Ola Maps](https://maps.olakrutrim.com) Places autocomplete | Indian shops, buildings and addresses missing from OpenStreetMap. Used only when `OLA_MAPS_API_KEY` is set, with a daily cap (`OLA_MAPS_DAILY_LIMIT`, default 3000) |
| Plus codes | [Open Location Code](https://github.com/google/open-location-code) (decoded locally) | Codes copied from Google Maps |
| Hourly forecast: rain, thunderstorms, visibility | [Open-Meteo](https://open-meteo.com), with [MET Norway](https://api.met.no) as the fallback when Open-Meteo rate-limits shared cloud IPs | Fewer people out in rain, fog dims lighting, flooded underpasses |
| Sunrise, sunset, twilight | [SunCalc](https://github.com/mourner/suncalc) (computed locally) | Day/night weighting |
| Opening hours evaluation | [opening_hours.js](https://github.com/opening-hours/opening_hours.js) | Whether a shop is open when you pass |
| Map tiles | [OpenFreeMap](https://openfreemap.org) | Base map |

India publishes no street-level crime data (NCRB statistics are city-level and annual), so SafeNav does not claim to use crime records. The model and its weights are documented in [docs/SAFETY_MODEL.md](docs/SAFETY_MODEL.md).

## Data storage

Accounts, contacts and trips are stored in Postgres: Supabase in production, so
nothing is lost when the server restarts or redeploys. Locally and in tests, the
same Postgres engine runs in-process (PGlite), so no database server is needed.
The schema is created and upgraded automatically on start (`src/lib/db/migrate.ts`,
generated with `npm run db:generate`). Tables live in a separate `safenav` schema
that Supabase's public REST API doesn't expose.

## Tech stack

- Next.js 15 (App Router) and React 19, TypeScript, Tailwind CSS 4
- MapLibre GL JS
- Drizzle ORM on Postgres: [Supabase](https://supabase.com) in production, PGlite (in-process Postgres) for development and tests
- Session auth (bcrypt plus httpOnly cookie, server-side sessions), Zod validation, same-origin checks, rate limiting
- Vitest unit tests and end-to-end API tests

## Getting started

```bash
npm install
cp .env.example .env.local   # set OSM_CONTACT_EMAIL (required by OSM usage policies)
npm run dev                   # http://localhost:3000
```

The database schema is created automatically on first use (`data/safenav.db`). Location requires HTTPS or `localhost`. To test on a phone, deploy, or use a tunnel such as `cloudflared` or `ngrok`.

### Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` / `npm start` | Production build and server |
| `npm test` | Unit tests |
| `E2E_BASE_URL=http://localhost:3000 npm test` | Also runs the end-to-end API tests against a running server |
| `npm run lint` / `npm run typecheck` | ESLint and TypeScript |
| `npm run icons` | Regenerates PWA icons from the SVG |
| `npm run smoke:live` | Live checks against the real public data services |
| `npm run cap:sync` / `cap:android` / `cap:ios` | Sync and open the native app projects |

## Deployment

**Render and Supabase (free tiers, the live setup):**

1. Create a Supabase project in the same region as the server. For least privilege, create a login role that owns a `safenav` schema and can connect to the database (see `scripts/` history or run the SQL in the Supabase SQL editor).
2. Set `DATABASE_URL` on Render to the **Session pooler** URL (`postgresql://<role>.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres`). Render can't reach Supabase's IPv6-only direct host.
3. Set `APP_URL`, `OSM_CONTACT_EMAIL` and the optional alert settings. Deploy. Tables are created and upgraded on start.

**Any Node host or VPS:** run `npm run build && npm start` with `DATABASE_URL` pointing at any Postgres 14+, or `file:/path/to/folder` on a persistent disk to use the built-in PGlite.

**Behind an outbound HTTP proxy:** Node's `fetch` ignores `HTTPS_PROXY` by default. Set `NODE_USE_ENV_PROXY=1` (Node 22.21+) so the server can reach the data services.

For real traffic, self-host OSRM and Overpass (both are open source with Docker images) and point `OSRM_FOOT_URL`, `OSRM_CAR_URL` and `OVERPASS_URL` at them. The public community servers are meant for light use.

### Reliability

The public data services rate-limit and go down independently, so every call is built to degrade instead of failing:

- **Mirrors:** each routing and Overpass variable takes a comma-separated list, tried in order. The built-in defaults already include three Overpass mirrors and two car-routing servers.
- **Circuit breaker:** a mirror that fails or hangs is skipped for 1 minute, doubling up to 10 minutes on repeated failures. Overpass's time budget is shared across mirrors, so a dead server costs one slow request, not every request. When every mirror is cooling down, plans return immediately from the stale cache or unscored.
- **Second engine:** if every OSRM server fails, routes come from Valhalla.
- **Truncated data rejected:** Overpass reports timeouts as HTTP 200 with partial data. These responses are rejected and never cached, so routes are never silently scored on empty data.
- **Stale cache:** expired cache entries are kept for 7 days and served when every upstream is down.
- **Second street-data source:** the public Overpass servers are often overloaded and block shared cloud IPs, Render's included. Every request also fetches OpenStreetMap vector tiles from the OpenFreeMap CDN. If Overpass hasn't answered within 8 seconds, scoring uses the tiles, and Overpass is skipped for the next 2 minutes. When Overpass does answer, its richer result is cached for next time.
- **Directions always returned:** if street data is unavailable, you still get routes and turn-by-turn directions, clearly marked as unscored.
- **Bounded time:** routing and street data each have a time budget, so a plan request finishes within the function limit.
- **`GET /api/health`** probes every upstream and the database: 200 if safe routing works, 503 if not. Point an uptime monitor at it. `?deep=0` checks only the database.

### Testing against live data

```bash
npm run build && npm start &
npm run smoke:live                        # or: npm run smoke:live -- https://your-domain
```

`scripts/smoke-live.mjs` first prints the health of every upstream. It then plans real walks in Delhi, Mumbai, Bengaluru, Indore and Kolkata, by day and at night, plus one step-free walk. It checks that routes are scored, ranked, explained and timed correctly, and exits non-zero on any failure.

### Ola Maps search (optional, free tier)

1. Sign in at [maps.olakrutrim.com](https://maps.olakrutrim.com), create a project and copy its API key.
2. Set `OLA_MAPS_API_KEY` on the server (on Render: service → Environment).
3. `/api/health` then lists `"place search (Ola Maps)": "configured"`. Search shows "Includes results from Ola Maps" when Ola contributes.

Ola results are merged with the OpenStreetMap ones and ranked together. If Ola is down, over quota or not configured, search carries on without it. Check Ola's current terms for attribution and caching rules; SafeNav caches Ola answers for one hour.

### Automatic SOS SMS (optional)

Without configuration, SOS opens the phone's SMS app with everything filled in. That is free and works offline. To have the server also send SMS automatically:

- **Twilio:** `SMS_PROVIDER=twilio`, plus `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER`.
- **MSG91:** `SMS_PROVIDER=msg91`, plus `MSG91_AUTH_KEY` and `MSG91_TEMPLATE_ID`. The template takes the variables `##name##`, `##link##` and `##place##`.

In India, application-to-person SMS needs **DLT registration** (TRAI rules): register your sender ID and message template on a DLT portal before going live.

## Project structure

```
src/
  app/                 Pages (plan, journey, safety, area, timer, report, contacts, help, fake-call, about, account, live viewer /t/[token])
    api/               Route handlers (auth, contacts, reports, routes/plan, trips + reroute, sos, share, places, geocode, safety/area, health)
  components/          Map, SOS system, route cards, search, navigation
  lib/
    safety/            Scoring engine (score.ts), route planning (plan.ts), area check (area.ts)
    location-input.ts  Coordinates, map links and plus codes
    providers/         OSRM, Valhalla, Overpass, Photon/Nominatim, Open-Meteo clients with failover and a shared DB cache
    client/            Browser hooks: GPS (native background GPS in the app), voice guidance, shake detection
    monitor.ts         Off-route / stopped / overdue rules for live journeys
    sos.ts             SOS text, SMS and WhatsApp links, emergency numbers
    db/                Drizzle schema and migrations
    server/            Auth, validation, SMS gateways, HTTP helpers
tests/                 Unit, planner integration (simulated outages) and end-to-end API tests
docs/SAFETY_MODEL.md   Scoring model, factors, weights and limitations
docs/NATIVE_APP.md     Building and publishing the Android/iOS app
android/, ios/         Capacitor native projects
scripts/smoke-live.mjs Live checks against the real data services
```

## Privacy and safety notes

- Live links use 128-bit random tokens, and only a SHA-256 hash is stored. They stop working 2 hours after a trip ends.
- Reports never reveal who filed them, and you can't vote on your own report.
- Request bodies are capped at 1 MB, so oversized posts can't exhaust server memory.
- `npm audit` flags maplibre-gl ≤ 6.4 (XSS in `DOM.sanitize`) and the postcss bundled with Next.js. Neither is reachable here: map popups use `setText`, and the map style is a fixed trusted source; postcss only processes our own CSS at build time. Both fixes need major-version upgrades, so take them deliberately.
- Location is sent only during a journey or an active SOS. Device preferences (step-free, voice, shake to SOS) stay on the phone.
- A safety score is guidance, not a guarantee. In an emergency, call **112**.

## License and attribution

Map data © OpenStreetMap contributors, available under the Open Database License. Respect the usage policies of the public OSRM, Overpass, Nominatim and Photon servers.
