# SafeNav: Safety Navigation System

SafeNav is a mobile-first web app (installable PWA) for getting around Indian cities safely. It:

- **Finds the safest walking route.** Every 100 m of a route is scored from real OpenStreetMap data: street lighting, footpaths, shops that are actually open at the hour you'll pass, isolated land such as industrial estates and parks at night, and distance to police stations and hospitals. It also uses community reports and the real sun position at your location.
- **Shares journeys live.** Trusted contacts get a link that shows your position, route, battery and status. No app or account is needed to view it.
- **Monitors cab and auto rides.** It records the number plate, then watches for detours, long unexplained stops and late arrival.
- **Checks in, then escalates.** If you leave the route, stop for too long or run late, it asks "Are you OK?". If you don't answer within 60 seconds, it raises an SOS automatically.
- **Sends SOS that works offline.** One hold opens a ready-to-send SMS to all contacts with your coordinates and live link. SMS needs no mobile data. There's also WhatsApp, one-tap 112, a loud alarm, and an optional automatic SMS gateway (Twilio or MSG91).
- **Takes crowdsourced reports.** Harassment, snatching, poor lighting, stray dogs and more. Reports fade over time, gain weight when others confirm them, and are hidden when flagged.
- **Shows nearby help and emergency numbers.** The nearest police stations, hospitals and 24-hour pharmacies, plus India's emergency numbers (112, 1091, 181, 108, 1098, 1930).

## Why a PWA

| Need | How the PWA covers it |
| --- | --- |
| Works on any Android or iPhone without an app store | Installs from the browser ("Add to Home screen") |
| SOS without mobile data | `sms:` links open the phone's own SMS app with the message filled in |
| GPS during a journey | `watchPosition` plus the Screen Wake Lock API keeps tracking while the app is open |
| Guardians without the app | The live link is an ordinary web page |
| Low cost | Only free, open data services; automatic SMS is optional |

Known limit: browsers pause location when the screen is locked or the app is in the background, so the journey screen keeps the display on. A native wrapper (Capacitor or Expo) would be the next step for background tracking and hardware SOS triggers. The engine in `src/lib` has no browser dependencies and can be reused there.

## Data sources (all real, all free)

| Data | Service | Used for |
| --- | --- | --- |
| Roads, lights, footpaths, shops, opening hours, land use, police, hospitals, transit, CCTV | OpenStreetMap via [Overpass API](https://overpass-api.de) | Safety factors |
| Walking and driving routes with alternatives | [OSRM](https://project-osrm.org) on routing.openstreetmap.de | Routes and turn-by-turn steps |
| Place search (autocomplete) | [Photon](https://photon.komoot.io) | Search box |
| Reverse geocoding | [Nominatim](https://nominatim.org) | Place names |
| Current rain | [Open-Meteo](https://open-meteo.com) | Fewer people outdoors in rain |
| Sunrise, sunset, twilight | [SunCalc](https://github.com/mourner/suncalc) (computed locally) | Day/night weighting |
| Opening hours evaluation | [opening_hours.js](https://github.com/opening-hours/opening_hours.js) | Whether a shop is open when you pass |
| Map tiles | [OpenFreeMap](https://openfreemap.org) | Base map |

India publishes no street-level crime data (NCRB statistics are city-level and annual), so SafeNav does not claim to use crime records. The model and its weights are documented in [docs/SAFETY_MODEL.md](docs/SAFETY_MODEL.md).

## Tech stack

- Next.js 15 (App Router) and React 19, TypeScript, Tailwind CSS 4
- MapLibre GL JS
- Drizzle ORM on SQLite/libSQL: a local file for development, [Turso](https://turso.tech) for production
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

## Deployment

**Vercel and Turso (free tiers):**

1. `turso db create safenav`, then `turso db tokens create safenav`.
2. Import the repository into Vercel. Set `DATABASE_URL` (the `libsql://…` URL), `DATABASE_AUTH_TOKEN`, `APP_URL` (your domain) and `OSM_CONTACT_EMAIL`.
3. Deploy. Tables are created on the first request.

**Any Node host or VPS:** run `npm run build && npm start` with `DATABASE_URL=file:/path/to/safenav.db` on a persistent disk.

For real traffic, self-host OSRM and Overpass (both are open source with Docker images) and point `OSRM_FOOT_URL`, `OSRM_CAR_URL` and `OVERPASS_URL` at them. The public community servers are meant for light use.

### Automatic SOS SMS (optional)

Without configuration, SOS opens the phone's SMS app with everything filled in. That is free and works offline. To have the server also send SMS automatically:

- **Twilio:** `SMS_PROVIDER=twilio`, plus `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN` and `TWILIO_FROM_NUMBER`.
- **MSG91:** `SMS_PROVIDER=msg91`, plus `MSG91_AUTH_KEY` and `MSG91_TEMPLATE_ID`. The template takes the variables `##name##`, `##link##` and `##place##`.

In India, application-to-person SMS needs **DLT registration** (TRAI rules): register your sender ID and message template on a DLT portal before going live.

## Project structure

```
src/
  app/                 Pages (plan, journey, report, contacts, help, about, account, live viewer /t/[token])
    api/               Route handlers (auth, contacts, reports, routes/plan, trips, sos, share, places, geocode)
  components/          Map, SOS system, route cards, search, navigation
  lib/
    safety/            Scoring engine (score.ts), route planning (plan.ts)
    providers/         OSRM, Overpass, Photon/Nominatim, Open-Meteo clients with a shared DB cache
    monitor.ts         Off-route / stopped / overdue rules for live journeys
    sos.ts             SOS text, SMS and WhatsApp links, emergency numbers
    db/                Drizzle schema and migrations
    server/            Auth, validation, SMS gateways, HTTP helpers
tests/                 Unit tests and end-to-end API tests
docs/SAFETY_MODEL.md   Scoring model, factors, weights and limitations
```

## Privacy and safety notes

- Live links use 128-bit random tokens, and only a SHA-256 hash is stored. They stop working 2 hours after a trip ends.
- Reports never reveal who filed them, and you can't vote on your own report.
- Location is sent only during a journey or an active SOS.
- A safety score is guidance, not a guarantee. In an emergency, call **112**.

## License and attribution

Map data © OpenStreetMap contributors, available under the Open Database License. Respect the usage policies of the public OSRM, Overpass, Nominatim and Photon servers.
