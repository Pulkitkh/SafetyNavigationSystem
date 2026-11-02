// Speaks lines given as phonemes (IPA), for languages the bundled phonemizer lacks.
import { KokoroTTS } from "kokoro-js";
import { env } from "@huggingface/transformers";
import fs from "node:fs";
env.localModelPath = new URL("./models/", import.meta.url).pathname;
env.allowRemoteModels = false;
const [, , outDir, jobsFile] = process.argv;
const jobs = JSON.parse(fs.readFileSync(jobsFile, "utf8"));
const tts = await KokoroTTS.from_pretrained("onnx-community/Kokoro-82M-v1.0-ONNX", { dtype: "q8", device: "cpu" });
fs.mkdirSync(outDir, { recursive: true });
for (const j of jobs) {
  const { input_ids } = tts.tokenizer(j.ph, { truncation: true });
  const audio = await tts.generate_from_ids(input_ids, { voice: j.voice ?? "hf_alpha", speed: j.speed ?? 1 });
  await audio.save(`${outDir}/${j.id}.wav`);
  console.log(j.id, (audio.audio.length / audio.sampling_rate).toFixed(2) + "s", j.slot ? `slot ${j.slot}s` : "");
}
