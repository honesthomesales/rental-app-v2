/**
 * Inbound keyword handling for STOP / START / HELP.
 */

export type InboundKeyword =
  | "opt_out"
  | "opt_in"
  | "help"
  | "none";

const OPT_OUT = new Set([
  "STOP",
  "STOPALL",
  "UNSUBSCRIBE",
  "CANCEL",
  "END",
  "QUIT",
]);

const OPT_IN = new Set(["START", "UNSTOP"]);

export function classifyInboundKeyword(body: string): InboundKeyword {
  const token = String(body || "")
    .trim()
    .toUpperCase()
    .replace(/\s+/g, " ");
  // Exact keyword or keyword as sole content (allow surrounding whitespace only)
  const first = token.split(" ")[0] || "";
  if (OPT_OUT.has(token) || OPT_OUT.has(first)) {
    // Require the whole message to be essentially the keyword
    if (OPT_OUT.has(token)) return "opt_out";
  }
  if (OPT_IN.has(token)) return "opt_in";
  if (token === "HELP") return "help";
  return "none";
}

export function isOptOutKeyword(body: string): boolean {
  return classifyInboundKeyword(body) === "opt_out";
}

export function isOptInKeyword(body: string): boolean {
  return classifyInboundKeyword(body) === "opt_in";
}
