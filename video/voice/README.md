# Hindi narration

The Hindi cut's voice is Kokoro-82M (Apache-2.0), voice `hf_alpha`, run offline.

Kokoro's bundled text-to-phoneme step only covers English, so each Hindi line in
`hindi-lines.json` is written directly as phonemes (IPA, in the symbols Kokoro
was trained on). `id` matches `src/timeline.ts`; `slot` is the English time
available, for reference; `speed` is Kokoro's speed.

To change a word's pronunciation, edit its `ph`, then from a folder with
`kokoro-js` and the model installed:

    node speak-phonemes.mjs out-hi hindi-lines.json

and copy the results to `public/audio/vo/hi/` (trimming leading silence) and
re-measure `src/vo-timing-hi.json`. Scenes stretch automatically if a line
gets longer.

Render: `--props='{"lang":"hi"}'` (add `"bgm":false` for the no-music cut).
