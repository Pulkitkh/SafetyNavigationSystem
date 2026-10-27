// Community report categories shared by the API, the scoring engine and the UI.

export interface ReportCategory {
  id: string;
  label: string;
  /** Positive values make a place less safe, negative values are reassuring reports. */
  severity: number;
  /** Days until the report's weight halves. */
  halfLifeDays: number;
  /** Only relevant after dark (e.g. lighting). */
  darkOnly?: boolean;
  emoji: string;
}

export const REPORT_CATEGORIES: ReportCategory[] = [
  { id: "harassment", label: "Harassment / eve-teasing", severity: 3, halfLifeDays: 90, emoji: "⚠️" },
  { id: "stalking", label: "Followed / stalked", severity: 3, halfLifeDays: 90, emoji: "👣" },
  { id: "snatching", label: "Chain / phone snatching", severity: 2.5, halfLifeDays: 90, emoji: "👜" },
  { id: "unsafe_crowd", label: "Drunk or rowdy groups", severity: 2, halfLifeDays: 45, emoji: "🍺" },
  { id: "deserted", label: "Deserted / isolated", severity: 1.5, halfLifeDays: 60, emoji: "🌫️" },
  { id: "poor_lighting", label: "Poor or no street lights", severity: 1.5, halfLifeDays: 60, darkOnly: true, emoji: "💡" },
  { id: "stray_dogs", label: "Aggressive stray dogs", severity: 1.5, halfLifeDays: 30, emoji: "🐕" },
  { id: "bad_footpath", label: "No / broken footpath", severity: 1, halfLifeDays: 120, emoji: "🚧" },
  { id: "other", label: "Other concern", severity: 1, halfLifeDays: 30, emoji: "❗" },
  { id: "well_lit", label: "Well lit at night", severity: -1, halfLifeDays: 90, darkOnly: true, emoji: "✨" },
  { id: "busy_safe", label: "Busy, feels safe", severity: -1, halfLifeDays: 60, emoji: "👥" },
  { id: "police_presence", label: "Regular police presence", severity: -1, halfLifeDays: 60, emoji: "👮" },
];

export const REPORT_CATEGORY_IDS = REPORT_CATEGORIES.map((c) => c.id) as [string, ...string[]];

export function reportCategory(id: string): ReportCategory | undefined {
  return REPORT_CATEGORIES.find((c) => c.id === id);
}

/** Reports older than this are ignored entirely. */
export const REPORT_MAX_AGE_DAYS = 365;
