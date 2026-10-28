"use client";

import { useEffect, useRef } from "react";
import { formatDistance } from "./api";

export function voiceSupported() {
  return typeof window !== "undefined" && "speechSynthesis" in window;
}

/** Speak through the device's own text-to-speech; works offline on most phones. */
export function speak(text: string, interrupt = false) {
  if (!voiceSupported()) return;
  const synth = window.speechSynthesis;
  if (interrupt) synth.cancel();
  const u = new SpeechSynthesisUtterance(text);
  // Prefer an Indian English voice when the device has one.
  const voice = synth.getVoices().find((v) => v.lang === "en-IN") ?? synth.getVoices().find((v) => v.lang.startsWith("en"));
  if (voice) u.voice = voice;
  u.lang = voice?.lang ?? "en-IN";
  u.rate = 1;
  synth.speak(u);
}

/** Distance from the next turn at which the turn is announced a second time. */
const NEAR_M = 30;

/**
 * Announces each step once when it becomes the next one ("In 200 m, turn left…")
 * and again just before it, so the phone can stay in a pocket or bag.
 */
export function useVoiceGuidance(enabled: boolean, step: { instruction: string; location: [number, number] } | null, distanceM: number | null) {
  const announced = useRef<{ key: string; near: boolean } | null>(null);
  useEffect(() => {
    if (!enabled || !step || distanceM == null) return;
    const key = `${step.instruction}@${step.location.join(",")}`;
    const prev = announced.current;
    if (prev?.key !== key) {
      announced.current = { key, near: distanceM <= NEAR_M };
      speak(distanceM > NEAR_M ? `In ${formatDistance(distanceM)}, ${lowerFirst(step.instruction)}` : step.instruction);
    } else if (!prev.near && distanceM <= NEAR_M) {
      announced.current = { key, near: true };
      speak(step.instruction);
    }
  }, [enabled, step, distanceM]);

  useEffect(() => {
    if (!enabled && voiceSupported()) window.speechSynthesis.cancel();
  }, [enabled]);
}

function lowerFirst(s: string) {
  return s ? s[0].toLowerCase() + s.slice(1) : s;
}
