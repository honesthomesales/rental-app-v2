/**
 * Auth / authorization helpers — mocked, no live writes / no secrets logged.
 */
import { NextResponse } from "next/server";

const getUserMock = jest.fn();

jest.mock("@supabase/supabase-js", () => ({
  createClient: () => ({
    auth: {
      getUser: (...args: unknown[]) => getUserMock(...args),
    },
  }),
}));

jest.mock("@supabase/ssr", () => ({
  createServerClient: () => ({
    auth: {
      getUser: async () => ({ data: { user: null }, error: null }),
      signOut: async () => ({ error: null }),
    },
  }),
}));

jest.mock("next/headers", () => ({
  cookies: async () => ({
    getAll: () => [],
    set: () => undefined,
  }),
}));

jest.mock("@/lib/supabase-server", () => ({
  supabaseServer: {
    from: jest.fn(),
  },
}));

import { supabaseServer } from "@/lib/supabase-server";
import {
  getAuthorizedServiceClient,
  isAuthError,
  requireApiAuth,
} from "@/lib/auth/api-auth";

function mockAppUser(row: Record<string, unknown> | null) {
  (supabaseServer.from as jest.Mock).mockReturnValue({
    select: () => ({
      eq: () => ({
        maybeSingle: async () => ({ data: row, error: null }),
      }),
    }),
  });
}

describe("API authorization", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    getUserMock.mockResolvedValue({ data: { user: null }, error: null });
  });

  it("15. logged-out API returns 401", async () => {
    const req = new Request("http://localhost/api/leases");
    const result = await requireApiAuth(req);
    expect(isAuthError(result)).toBe(true);
    expect((result as NextResponse).status).toBe(401);
  });

  it("16. missing or inactive app user receives 403", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "auth-1", email: "a@b.c" } },
      error: null,
    });
    mockAppUser(null);
    const req = new Request("http://localhost/api/leases", {
      headers: { Authorization: "Bearer fake-token" },
    });
    const result = await requireApiAuth(req);
    expect(isAuthError(result)).toBe(true);
    expect((result as NextResponse).status).toBe(403);
  });

  it("19. readonly cannot use write methods", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "auth-1", email: "ro@example.com" } },
      error: null,
    });
    mockAppUser({
      id: "u1",
      auth_user_id: "auth-1",
      email: "ro@example.com",
      role: "readonly",
      is_active: true,
    });
    const req = new Request("http://localhost/api/payments", {
      method: "POST",
      headers: { Authorization: "Bearer fake-token" },
    });
    const result = await requireApiAuth(req, { write: true });
    expect(isAuthError(result)).toBe(true);
    expect((result as NextResponse).status).toBe(403);
  });

  it("18. staff can use write methods", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "auth-2", email: "staff@example.com" } },
      error: null,
    });
    mockAppUser({
      id: "u2",
      auth_user_id: "auth-2",
      email: "staff@example.com",
      role: "staff",
      is_active: true,
    });
    const req = new Request("http://localhost/api/payments", {
      method: "POST",
      headers: { Authorization: "Bearer fake-token" },
    });
    const result = await requireApiAuth(req, { write: true });
    expect(isAuthError(result)).toBe(false);
    if (!isAuthError(result)) {
      expect(result.role).toBe("staff");
    }
  });

  it("17. owner can access owner-only routes", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "auth-3", email: "owner@example.com" } },
      error: null,
    });
    mockAppUser({
      id: "u3",
      auth_user_id: "auth-3",
      email: "owner@example.com",
      role: "owner",
      is_active: true,
    });
    const req = new Request("http://localhost/api/data-health/future-payments", {
      headers: { Authorization: "Bearer fake-token" },
    });
    const result = await requireApiAuth(req, { ownerOnly: true });
    expect(isAuthError(result)).toBe(false);
  });

  it("20. service-role access helper only after authorization", async () => {
    getUserMock.mockResolvedValue({
      data: { user: { id: "auth-3", email: "owner@example.com" } },
      error: null,
    });
    mockAppUser({
      id: "u3",
      auth_user_id: "auth-3",
      email: "owner@example.com",
      role: "owner",
      is_active: true,
    });
    const req = new Request("http://localhost/api/leases", {
      headers: { Authorization: "Bearer fake-token" },
    });
    const auth = await requireApiAuth(req);
    expect(isAuthError(auth)).toBe(false);
    if (!isAuthError(auth)) {
      expect(getAuthorizedServiceClient(auth)).toBe(supabaseServer);
    }
  });
});
