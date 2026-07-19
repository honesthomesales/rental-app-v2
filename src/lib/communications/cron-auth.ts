import { NextResponse } from "next/server";

/**
 * Fail closed: missing/blank secret rejects every request, including GET.
 * Vercel Cron and manual callers must both send Authorization: Bearer <secret>.
 */
export function authorizeCommunicationCron(
  request: Request,
  secretEnvKeys: string[],
): NextResponse | null {
  const configured = secretEnvKeys
    .map((key) => String(process.env[key] || "").trim())
    .find((value) => value.length > 0);

  if (!configured) {
    return NextResponse.json(
      { error: "Cron secret is not configured" },
      { status: 503 },
    );
  }

  if (request.headers.get("authorization") !== `Bearer ${configured}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return null;
}
