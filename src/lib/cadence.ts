export function normalizeCadence(raw: unknown): "weekly" | "biweekly" | "monthly" | null {
  const s = String(raw ?? "").trim().toLowerCase().replace(/[_-]/g, " ").replace(/\s+/g, " ");
  if (/^weekly|^week($| )/.test(s)) return "weekly";
  if (/^bi ?weekly|^every 2 weeks|^fortnight/.test(s)) return "biweekly";
  if (/^monthly|^month|^mo|^mth/.test(s)) return "monthly";
  return null;
}
