import {
  AUTH_INIT_SAFETY_MS,
  GET_SESSION_TIMEOUT_MS,
  pickEmail,
  resolveSessionApiResult,
  shouldTryClientSessionAfterCookieCheck,
} from "@/lib/auth/auth-init";

describe("auth init helpers", () => {
  it("checks cookies before trying client session only on 401", () => {
    expect(shouldTryClientSessionAfterCookieCheck(401)).toBe(true);
    expect(shouldTryClientSessionAfterCookieCheck(403)).toBe(false);
    expect(shouldTryClientSessionAfterCookieCheck(500)).toBe(false);
  });

  it("maps session API statuses to auth outcomes", () => {
    expect(resolveSessionApiResult(401).kind).toBe("unauthenticated");
    expect(resolveSessionApiResult(403).kind).toBe("session_error");
    expect(resolveSessionApiResult(500).kind).toBe("unable_to_load");
    expect(
      resolveSessionApiResult(200, { email: "a@b.com", role: "owner" }),
    ).toEqual({
      kind: "authenticated",
      email: "a@b.com",
      role: "owner",
    });
  });

  it("prefers API email but falls back to session user email", () => {
    expect(
      pickEmail("api@example.com", {
        user: { email: "session@example.com" },
      } as never),
    ).toBe("api@example.com");
    expect(
      pickEmail(null, {
        user: { email: "session@example.com" },
      } as never),
    ).toBe("session@example.com");
  });

  it("uses bounded timeouts so Android never hangs forever", () => {
    expect(AUTH_INIT_SAFETY_MS).toBeLessThanOrEqual(10_000);
    expect(GET_SESSION_TIMEOUT_MS).toBeLessThan(AUTH_INIT_SAFETY_MS);
  });
});
