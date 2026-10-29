# Safety model

The model is a transparent, rule-based heuristic built from established frameworks. It is not a trained model. All constants live in `src/lib/safety/score.ts` and are covered by tests in `tests/score.test.ts`.

## Frameworks

- **Safetipin safety audit.** Developed in Delhi and used by Indian city governments and UN Women. It has nine parameters: lighting, openness, visibility, people, security, walk path, public transport, gender usage and feeling.
- **CPTED (Crime Prevention Through Environmental Design).** Natural surveillance ("eyes on the street"), access to help, and avoidance of isolated, unmaintained spaces.

SafeNav measures the parameters that open data can support. "Gender usage" and "feeling" cannot be read from map data, so they come in indirectly through community reports.

## Pipeline

1. **Candidates.** OSRM foot routing with `alternatives=3` (Valhalla if every OSRM server fails). Step-free plans also request a Valhalla route with the wheelchair pedestrian profile, which avoids steps. For walks longer than 400 m with fewer than three alternatives, extra candidates are routed through via-points offset 22% of the trip distance (150–1500 m) to each side of the straight line. Near-duplicates (85%+ overlap within 25 m) and routes more than 1.6× slower than the fastest are dropped.
2. **Data.** One Overpass request fetches, for all candidates:
   - roads within 25 m;
   - street lamps (40 m), CCTV (50 m) and footfall places (60 m);
   - transit (150 m), police (1.5 km) and hospitals (1 km);
   - isolating land use touching the route (20 m).

   If Overpass doesn't answer within 8 seconds, the same features come from OpenStreetMap vector tiles (OpenMapTiles schema, zoom 14): roads with class, footway/steps/pedestrian subclass, surface, tunnels; points of interest with names; building footprints; land use. Tiles carry no street lamps, `lit`/`sidewalk` tags or opening hours, so lighting falls back to the road-class priors, opening times to typical Indian hours, and confidence is reduced and explained in the UI.

   Community reports come from the database. Weather comes from Open-Meteo's hourly forecast for the hour at the middle of the walk, so a walk planned for later uses that hour's forecast.
3. **Sampling.** The route is sampled every 20 m and grouped into 100 m segments. Each sample is matched to the nearest mapped road within 20 m, or 35 m as a fallback.
4. **Timing.** Each segment is evaluated at its own ETA (departure plus distance-proportional travel time), so a shop that closes while you walk counts as closed. The light period (day, twilight, night or late night) comes from the sun position at the route midpoint.

## Factors (0–100, higher is safer)

| Factor | Inputs | Rules |
| --- | --- | --- |
| Lighting | `lit=*`, `highway=street_lamp`, forecast visibility | lit=yes → 100; limited → 60; lit=no → 10 (55 with a lamp nearby). Untagged: 2+ lamps → 90, 1 lamp → 75, otherwise a prior by road class (main road 70, tertiary 60, residential 45, service 35, footway/path 35, track 10). ×0.8 in fog (visibility < 1 km) outside daylight. |
| Homes & shops facing the street | building footprints (`out ids bb`), excluding factories, warehouses, sheds and garages | Share of the street with a building within 25 m → 15 + 85 × share. With fewer than 3 mapped buildings per km (and under 20% of the street lined), building data counts as missing: 50, and the UI says so. |
| People & open shops | shops, eateries, pharmacies, fuel, banks, venues, places of worship, hospitals, transit | Each place is weighted by kind × probability it is open at the ETA. `opening_hours` is parsed when present; otherwise typical Indian hours apply (e.g. shops 0.75 from 9:00–20:00, 0.25 from 7:00–9:00, 0.03 after 23:00; eateries 0.4 from 6:00–9:00 for tea and breakfast stalls; bus and metro stops 1 from 6:00–22:00, 0.6 until 23:00, then 0.1). Score = 100·(1−e^(−x/2)), where x is the weighted open count per 100 m. After dark: +8 on main roads (passing traffic), ×0.7 when raining. |
| Footpath & road type | `highway`, `sidewalk*`, `tunnel`, `service`, `surface`, `smoothness`, `wheelchair`, `lanes`, `maxspeed` | Footway/pedestrian 90; main road with sidewalk 85, without 25 (15 if 4+ lanes or ≥ 60 km/h; unknown footpath on such roads −10), unknown 35–60 by class; residential 70; back lane (`service=alley`) 40 after dark; track 25–40; pedestrian underpass 30 at night, 20 in heavy rain (flooding). Step-free: steps 5, `wheelchair=no` 15, unpaved ≤ 30, rough ≤ 35, `wheelchair=yes` ≥ 85. |
| Openness | `landuse`, `leisure`, `natural`, `amenity=grave_yard` | Penalty (night / day): industrial 70/35, cemetery 75/30, woods/scrub 75/45, park 55/10, waste land 65/35, construction 65/35, railway 50/25, military 40/20. Twilight uses the midpoint. |
| Help nearby | police, open hospitals / fuel / 24h pharmacies, CCTV | Police: ≤300 m → 100, falling linearly to 20 at 2 km. Safe haven: ≤200 m → 100, falling to 30 at 1 km. The higher of police and 0.85 × haven counts; +10 if CCTV is mapped. |
| Public transport | bus stops, stations | ≤100 m 100, ≤250 m 75, ≤500 m 55, else 40. |
| Community reports | user reports within 60 m | Weight = severity × 0.5^(age / half-life) × credibility × time-of-day match. Credibility = 0.6 + 0.2·confirmations − 0.25·flags, clamped to 0.2–1.5. Score = 80·e^(−W/1.5); reassuring reports raise it towards 100. |

### Report categories

| Category | Severity | Half-life (days) |
| --- | --- | --- |
| Harassment / eve-teasing, followed / stalked | 3 | 90 |
| Chain / phone snatching | 2.5 | 90 |
| Drunk or rowdy groups | 2 | 45 |
| Deserted, poor lighting (dark only), aggressive stray dogs | 1.5 | 60 / 60 / 30 |
| Broken footpath, other | 1 | 120 / 30 |
| Well lit (dark only), busy, police presence | −1 | 60–90 |

Reports older than 365 days are ignored. Reports flagged 3+ times, and more often flagged than confirmed, are hidden.

## Weights by light period

| Factor | Day | Twilight | Night | Late night (23–05) |
| --- | --- | --- | --- | --- |
| Lighting | 0% | 14% | 22% | 22% |
| People & open shops | 18% | 18% | 18% | 22% |
| Homes & shops facing the street | 7% | 7% | 8% | 8% |
| Footpath & road type | 23% | 16% | 9% | 5% |
| Openness | 11% | 12% | 13% | 14% |
| Help nearby | 10% | 9% | 9% | 10% |
| Public transport | 6% | 6% | 5% | 3% |
| Community reports | 25% | 18% | 16% | 16% |

## Route score and ranking

- **Route score:** 0.65 × length-weighted segment mean + 0.35 × the 10th-percentile segment. A route is only as safe as its weakest stretch.
- **Bands:** ≥70 "Safer", 50–69 "Use caution", <50 "Avoid if possible".
- **Weak stretches:** consecutive segments scoring below 50 and at least 80 m long, with their most common reasons.
- **Recommendation:** the safest route, unless it is less than 5 points safer than the fastest *and* more than 25% slower.
- **Step-free:** routes using mapped steps are only recommended when no step-free route exists, and are listed after the step-free ones.

## Weather (Open-Meteo hourly forecast)

| Condition | Rule | Effect |
| --- | --- | --- |
| Rain | WMO drizzle/rain/shower/storm code, or ≥ 0.5 mm/h | People & open shops ×0.7 outside daylight |
| Heavy rain | ≥ 4 mm/h, heavy rain/shower code, or thunderstorm | Pedestrian underpasses score 20 ("may be waterlogged") |
| Fog | Visibility < 1 km, or fog code 45/48 | Lighting ×0.8 outside daylight |

If the forecast is unavailable, routes are scored without weather. The plan never fails because of it.

## Data confidence

OpenStreetMap coverage in Indian cities varies. Each route reports coverage as the average of:

- the share of samples matched to a mapped road;
- the share with known lighting (after dark only);
- the share of main-road samples with known footpaths;
- the share of nearby places that publish opening hours.

The levels are High (≥60%), Medium (≥30%) and Low. Unknown data is never scored as safe: it falls back to conservative priors, and the UI says so.

## Journey monitoring (`src/lib/monitor.ts`)

| Rule | Walk | Ride |
| --- | --- | --- |
| Off route | > 80 m + GPS accuracy, for 45 s | > 500 m + accuracy, for 90 s |
| Stopped | within 30 m for 6 min | within 80 m for 5 min |
| Overdue | 10 min past expected arrival | 15 min past (ride ETA × 1.5 for Indian traffic) |
| Arrived | within 60 m of the destination | within 150 m |

Fixes with accuracy worse than 150 m are ignored. Answering "I'm OK" mutes that rule for 5 minutes (10 for overdue). An unanswered check-in raises an SOS after 60 seconds if automatic SOS is on.

## Area check ("Is it safe here?", `src/lib/safety/area.ts`)

The same factors and weights, evaluated at the current moment for one point:

- Streets within 150 m are sampled every 20 m for lighting, footpath and frontage.
- Places within 200 m are counted. The circle holds about 10.5 of the 100 × 120 m strips a route segment covers, so the count is divided by that to keep both scores on one scale.
- Police within 2 km, open havens within 1.5 km, community reports within 200 m.
- The result also lists places open now, the nearest police station and the nearest open hospital, petrol pump or pharmacy, each with a safety-scored route.

Police stations without published hours count as open round the clock, since stations in India are staffed 24 hours.

## Land use from relations

Industrial estates, cemeteries, parks, railway land and military areas are often mapped as multipolygon relations rather than single closed ways. Their outer members are joined into rings (`assembleRings`). Inner rings are ignored, which is conservative.

## Known limitations

- There is no street-level crime data for India. If a city publishes geocoded data, it can be added as another factor.
- Priors and weights are expert-set. They should be calibrated against Safetipin audit data or user feedback where available.
- One Overpass call per plan. Very long walks (>15 km) are not scored.
- OpenStreetMap rarely maps kerbs, ramps or broken pavements, so step-free results are only as good as local mapping.
- If no street data is available after all mirrors and the stale cache, routes are returned unscored with a note, rather than not at all.
