// SOS message and deep-link helpers, shared by the browser and the server.

/** Emergency numbers in India (ERSS 112 covers police, fire and ambulance). */
export const EMERGENCY_NUMBERS = [
  { number: "112", label: "Emergency (police, fire, ambulance)", primary: true },
  { number: "1091", label: "Women helpline (police)" },
  { number: "181", label: "Women helpline (Ministry of WCD)" },
  { number: "108", label: "Ambulance" },
  { number: "1098", label: "Child helpline" },
  { number: "1930", label: "Cyber crime / online fraud" },
] as const;

export interface SosMessageInput {
  name: string;
  liveUrl?: string | null;
  lat?: number | null;
  lng?: number | null;
  accuracyM?: number | null;
  vehicle?: string | null;
  reason?: string | null;
}

export function mapsLink(lat: number, lng: number) {
  return `https://maps.google.com/?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
}

/**
 * Plain-text SOS body. Kept short so it fits in two SMS segments, and it works
 * even if our server is unreachable: the Google Maps link needs only coordinates.
 */
export function sosMessage(i: SosMessageInput): string {
  const lines = [`SOS: ${i.name} needs help${i.reason ? ` (${i.reason})` : ""}.`];
  if (i.lat != null && i.lng != null) {
    const acc = i.accuracyM ? ` ±${Math.round(i.accuracyM)}m` : "";
    lines.push(`Location${acc}: ${mapsLink(i.lat, i.lng)}`);
  } else {
    lines.push("Location not available yet.");
  }
  if (i.liveUrl) lines.push(`Live tracking: ${i.liveUrl}`);
  if (i.vehicle) lines.push(`Vehicle: ${i.vehicle}`);
  lines.push("Call them now. If unreachable, dial 112.");
  return lines.join("\n");
}

export function journeyMessage(name: string, destination: string, liveUrl: string, eta: Date, vehicle?: string | null) {
  const time = eta.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" });
  return [
    `${name} is ${vehicle ? "taking a ride" : "walking"} to ${destination}${vehicle ? ` in ${vehicle}` : ""}. Expected by ${time}.`,
    `Follow live: ${liveUrl}`,
  ].join("\n");
}

/**
 * sms: URI with several recipients. iOS and Android disagree on the format:
 * iOS separates the body with "&" and needs the /open?addresses= form for groups.
 */
export function smsUri(phones: string[], body: string, platform: "ios" | "android" | "other"): string {
  const encoded = encodeURIComponent(body);
  if (platform === "ios") {
    return phones.length > 1 ? `sms://open?addresses=${phones.join(",")}&body=${encoded}` : `sms:${phones[0] ?? ""}&body=${encoded}`;
  }
  return `sms:${phones.join(",")}?body=${encoded}`;
}

export function whatsappUri(phone: string, body: string) {
  return `https://wa.me/${phone.replace(/\D/g, "")}?text=${encodeURIComponent(body)}`;
}

export function detectPlatform(userAgent: string): "ios" | "android" | "other" {
  if (/iPhone|iPad|iPod/i.test(userAgent)) return "ios";
  if (/Android/i.test(userAgent)) return "android";
  return "other";
}
