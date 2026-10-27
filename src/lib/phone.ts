/**
 * Normalise a phone number to E.164. Indian numbers may be typed as 10 digits,
 * with a leading 0, or with 91/+91; mobile numbers start with 6–9.
 */
export function normalizePhone(input: string): string | null {
  const raw = input.trim();
  const digits = raw.replace(/[\s\-().]/g, "");
  if (/^[6-9]\d{9}$/.test(digits)) return `+91${digits}`;
  if (/^0[6-9]\d{9}$/.test(digits)) return `+91${digits.slice(1)}`;
  if (/^91[6-9]\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\+91\d{10}$/.test(digits)) return /^\+91[6-9]/.test(digits) ? digits : null;
  if (/^\+[1-9]\d{7,14}$/.test(digits)) return digits;
  return null;
}

export const VEHICLE_TYPES = ["cab", "auto", "bike_taxi", "bus", "other"] as const;
export type VehicleType = (typeof VEHICLE_TYPES)[number];

export const VEHICLE_LABELS: Record<VehicleType, string> = {
  cab: "Cab / taxi",
  auto: "Auto-rickshaw",
  bike_taxi: "Bike taxi",
  bus: "Bus",
  other: "Other vehicle",
};

/**
 * Indian registration plates: state code + RTO number + series + number
 * (e.g. MP09AB1234, DL3CAB1234), or the Bharat series (e.g. 22BH1234AA).
 */
export function normalizePlate(input: string): string | null {
  const p = input.toUpperCase().replace(/[\s\-.]/g, "");
  if (/^[A-Z]{2}\d{1,2}[A-Z]{0,3}\d{1,4}$/.test(p)) return p;
  if (/^\d{2}BH\d{4}[A-Z]{1,2}$/.test(p)) return p;
  return null;
}
