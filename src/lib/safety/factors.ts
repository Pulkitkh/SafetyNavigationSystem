// Factor names and labels, kept separate from the scoring engine so the UI can
// import them without bundling the engine.

export type Factor = "lighting" | "activity" | "walkpath" | "isolation" | "help" | "transit" | "community";
export const FACTORS: Factor[] = ["lighting", "activity", "walkpath", "isolation", "help", "transit", "community"];

export const FACTOR_LABELS: Record<Factor, string> = {
  lighting: "Street lighting",
  activity: "People & open shops",
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
