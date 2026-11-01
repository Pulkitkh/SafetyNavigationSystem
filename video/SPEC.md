# SafeNav intro video: design spec

The first video in SafeNav's social series: what the problem is, what SafeNav does about it, and one walk home that shows it working.

## Product brief

- **Product:** SafeNav, a free women's safety navigation app (web, installable PWA, Android).
- **Core promise:** the safest way home, not just the fastest; a journey your family can follow live; an SOS that reaches your contacts with your location.
- **Audience:** young women in Indian cities who walk or take autos/cabs at night, and the parents and friends who worry about them.
- **Where it runs:** Instagram Reels, YouTube Shorts, WhatsApp status, LinkedIn/X. The master is vertical, 1080×1920 at 30 fps, about 95 s.

## Decisions

| Need | Decision | Why |
| --- | --- | --- |
| Problem, solution, demo, use case | One story, Priya's walk home at 10 pm, carries all four: a hook, two facts, why maps fail her, the reveal, then the app at each step of the same walk | A single relatable case is easier to follow than a feature list, and the demo *is* the use case |
| A female character | Priya as an illustrated silhouette in the night and home scenes, plus a female narrator | A silhouette reads clearly at phone size and avoids an uncanny hand-drawn face |
| Narration | Kokoro TTS, voice `af_heart` (Apache-2.0 model, generated offline), one file per line | No cloud TTS reachable; line files give exact durations for timing captions and scenes |
| Facts | NCRB *Crime in India 2023*: 4,48,211 crimes against women (≈1,228 a day). She Shakti Suraksha Survey 2025 (CNN-News18): 82% of women feel safe by day, 48% at night. Sources shown on screen | Verified before writing; nothing is invented |
| Claims about the app | Only what it does today: street-by-street checks, safety search, live following, check-ins, SOS with live location, "reached safely" text, free in the browser and on Android | The video must not promise features that aren't live (no "rings on silent": Firebase isn't configured) |
| App footage | Real screens: production planner for the routes (Indore, Rajwada → Palasia Square, at 10 pm), local server for the signed-in flows with fictional people (Priya Sharma, Sunita "Maa" Sharma) | Q1: real pages, no personal data |
| Captions | Burned in, phrase by phrase, top third, ≥ 60 px | Most social video is watched muted; the bottom of the frame is covered by platform UI |
| Music | Hook and problem section: a clean synthesized pad (pure tones, no noise; the earlier street ambience read as hiss), heartbeat on the facts. From the reveal: *House Vibez* (Lily J, Mixkit free licence), starting on a kick exactly at the logo impact, kept low under the voice | A beat under the problem would trivialise it; the music arriving with SafeNav is the turn of the story |
| Beat sync | Deliberately loose: cuts follow the narration, only the logo impact sits on a kick | A narration-led film where the music is a bed; strict beat cuts would fight the voice (deviation from the skill's rule 5, noted here) |
| Effects | Mixkit-licensed effects with traceable sources only; the riser is synthesized | Clean for commercial posting |

## Visual tokens (from the app)

- Font: Plus Jakarta Sans (the app's own file), 800 for captions and numbers, 600 for labels.
- Night: canvas `#0c0b14`, surface `#16151f`, line `#2b2a3a`; sky gradient `#0c0b14 → #1d1747`.
- Brand: `#5b3fd6`, gradient `#7c5cff → #5b3fd6 → #3a2aa8`, light brand text `#b2a5ff`.
- States: safe `#0f7a55` / `#4ade9b`, caution `#fbbf4a`, SOS `#e11d48`; lamp light `#ffcf7a`.
- Motion: calm and caring in the problem section (≈40 f moves, symmetric ease); trustworthy and lightly lively after the reveal (≈24 f entrances, `bezier(0.25,0.46,0.45,0.94)`, overshoot ≤ 1.06 only on chips that "pop"). No handheld shake (Q3).

## Hook (added after the first cut)

Reels viewers decide in the first 1–3 s, so the video now opens on text and voice from frame 0, calling out who it is for and the problem: six hard cuts, one per line.

| Time | Line | Picture |
| --- | --- | --- |
| 0.0 | Keys between your fingers. | Keys swing in close-up, bass hit on frame 0 |
| 1.5 | A fake phone call. | Phone ringing ("Papa") |
| 2.7 | Walking a little faster. | Priya walks at nearly double pace |
| 4.05 | "Text me when you reach." | Maa's message lands |
| 5.3 | If you're a woman, you know this routine. | The four habits as tiles, each ticked |
| 7.7 | You shouldn't have to. | Black, big type; then the story begins |

The routine scene (old 6.6–12.7 s) is gone, since the hook covers it. Everything after the night street keeps its timing, shifted by 3.3 s (`HOOK`, `SHIFT_F` in `timeline.ts`). The outro closes with a share prompt that echoes the hook ("Send this to someone who always texts 'reached'") and "Follow for part 2".

## Storyboard (seconds, before the hook shift)

| # | Time | Scene | Key motion |
| --- | --- | --- | --- |
| 1 | 0.0–6.6 | Night street: Priya walks under street lamps, one flickering, shutters down | Slow push-in, parallax skyline, walk cycle |
| 2 | 6.6–12.7 | The routine: keys, phone, a text to Maa | Keys slide in, phone lights, messages type and send |
| 3 | 12.7–23.4 | 4,48,211 crimes against women in 2023; 1,228 a day | Odometer roll, heartbeat on landing; 1,228 dots fill in, one per case |
| 4 | 23.4–29.0 | 82% feel safe by day, 48% after dark | Day half then night half, rings fill |
| 5 | 29.0–35.4 | Maps show the fastest route, not the safest | Route draws through an unlit lane, the lane flickers red; "No street lights", "Shops shut", "Nobody around" |
| 6 | 35.4–42.0 | Reveal: SafeNav, "Navigation that puts your safety first" | Riser, logo impact on a kick, wordmark, hold ≥ 1 s |
| 7 | 42.0–48.0 | Priya plans the walk | Phone rises in; tap on Find safest route |
| 8 | 48.0–54.4 | Street lights, open shops, footpaths, police, time of night | Scan line over the map, five chips pop in time with the words |
| 9 | 54.4–61.6 | The safest route, and why | Zoom into the recommended card, marker on "Found by safety search" and "2 min longer, 3 points safer" |
| 10 | 61.6–66.6 | She starts; Maa follows live | Two phones, a live link pulsing between them |
| 11 | 66.6–71.0 | If she strays, SafeNav checks in | The real "Are you OK?" check-in |
| 12 | 71.0–80.4 | SOS: long press, Maa's phone alerts, "On the way to you" | Hold ring on SOS, red flash, Maa's alert, answer appears on Priya's screen |
| 13 | 80.4–86.2 | Home safe; "reached safely" text to Maa | Warm doorway, arrival screen, message lands on Maa's phone |
| 14 | 86.2–95.0 | Free, in your browser and on Android. Get home safe. | Logo, URL, follow; final hold |

## Build notes

- Captions are hidden on lines 7, 8, 16 and 17: those words are already on screen as large type.
- Each scene draws over its own span and the next one fades in on top (`components/Scene.tsx`); every animation cue comes from the caption timing in `timeline.ts`, so a re-recorded line moves its visuals with it.
- Render: `REMOTION_BROWSER=<chrome-headless-shell> npx remotion render src/index.ts SafeNavIntro out/safenav-intro.mp4`; without music: add `--props='{"bgm":false}'`.
