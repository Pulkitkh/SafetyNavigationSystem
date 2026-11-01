// Factor names and labels, kept separate from the scoring engine so the UI can
// import them without bundling the engine.

export type Factor = "lighting" | "activity" | "frontage" | "walkpath" | "isolation" | "help" | "transit" | "community";
export const FACTORS: Factor[] = ["lighting", "activity", "frontage", "walkpath", "isolation", "help", "transit", "community"];

export const FACTOR_LABELS: Record<Factor, string> = {
  lighting: "Street lighting",
  activity: "People & open shops",
  frontage: "Homes & shops facing the street",
  walkpath: "Footpath & road type",
  isolation: "Openness of surroundings",
  help: "Help nearby",
  transit: "Public transport access",
  community: "Community reports",
};

export function scoreColor(score: number | null | undefined) {
  if (score == null) return "#2563eb";
  return score >= 70 ? "#15803d" : score >= 50 ? "#d97706" : "#dc2626";
}

/** For cab and auto rides some factors mean something else (see RIDE_WEIGHTS). */
const RIDE_LABELS: Partial<Record<Factor, string>> = {
  walkpath: "Road type (busy main roads vs lanes)",
  activity: "Open places along the way",
  isolation: "Isolated land along the route",
};

export function factorLabel(f: Factor, mode: "walk" | "ride" = "walk") {
  return (mode === "ride" ? RIDE_LABELS[f] : undefined) ?? FACTOR_LABELS[f];
}
