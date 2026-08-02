/**
 * Explicit auth initialization states for protected UI/data loading.
 * Queries must not run while status is `loading`.
 */
export type AuthStatus =
  | "loading"
  | "authenticated"
  | "unauthenticated"
  | "session_error";

export type ProtectedDataIssue =
  | "auth_pending"
  | "data_pending"
  | "sign_in_required"
  | "session_expired"
  | "access_denied"
  | "unable_to_load"
  | "network_failure";

export type ProtectedDataView =
  | { kind: "auth_pending"; message: string }
  | { kind: "data_pending"; message: string }
  | { kind: "sign_in_required"; message: string }
  | { kind: "session_expired"; message: string }
  | { kind: "access_denied"; message: string }
  | { kind: "unable_to_load"; message: string }
  | { kind: "network_failure"; message: string }
  | { kind: "ready" }
  | { kind: "empty"; message: string };

const MESSAGES = {
  auth_pending: "Checking sign-in…",
  sign_in_required: "Sign in required",
  session_expired: "Session expired — Sign In",
  access_denied: "Access denied",
  unable_to_load: "Unable to load leases",
  network_failure: "Unable to load leases",
} as const;

/** Gate: do not run protected queries until auth is resolved. */
export function shouldRunProtectedQueries(status: AuthStatus): boolean {
  return status === "authenticated";
}

export function isAuthResolved(status: AuthStatus): boolean {
  return status !== "loading";
}

/**
 * Map auth status + HTTP outcome to a user-facing view.
 * Never treats 401/403/network/auth-pending as a genuine empty list.
 */
export function resolveProtectedDataView(options: {
  authStatus: AuthStatus;
  loading: boolean;
  httpStatus: number | null;
  networkError: boolean;
  itemCount: number;
  emptyMessage?: string;
  loadNoun?: string;
}): ProtectedDataView {
  const noun = options.loadNoun || "leases";
  const emptyMessage =
    options.emptyMessage || `No active ${noun} found`;

  if (options.authStatus === "loading") {
    return { kind: "auth_pending", message: MESSAGES.auth_pending };
  }
  if (options.authStatus === "unauthenticated") {
    return { kind: "sign_in_required", message: MESSAGES.sign_in_required };
  }
  if (options.authStatus === "session_error") {
    return { kind: "session_expired", message: MESSAGES.session_expired };
  }

  if (options.networkError) {
    return {
      kind: "network_failure",
      message: `Unable to load ${noun}`,
    };
  }

  if (options.httpStatus === 401) {
    return { kind: "session_expired", message: MESSAGES.session_expired };
  }
  if (options.httpStatus === 403) {
    return { kind: "access_denied", message: MESSAGES.access_denied };
  }
  if (options.httpStatus != null && options.httpStatus >= 400) {
    return {
      kind: "unable_to_load",
      message: `Unable to load ${noun}`,
    };
  }

  // Authenticated data fetch in flight — never mislabel as "Checking sign-in…"
  if (options.loading) {
    if (options.authStatus === "authenticated") {
      return {
        kind: "data_pending",
        message: `Loading ${noun}…`,
      };
    }
    return { kind: "auth_pending", message: MESSAGES.auth_pending };
  }

  if (options.itemCount === 0) {
    return { kind: "empty", message: emptyMessage };
  }

  return { kind: "ready" };
}

/** True only when an authenticated, successful response genuinely has zero rows. */
export function isGenuineEmptyState(view: ProtectedDataView): boolean {
  return view.kind === "empty";
}

export function logoutRedirectPath(): string {
  return "/login";
}

export function classifyFetchFailure(
  status: number | null,
  networkError: boolean,
): ProtectedDataIssue | null {
  if (networkError) return "network_failure";
  if (status === 401) return "session_expired";
  if (status === 403) return "access_denied";
  if (status != null && status >= 400) return "unable_to_load";
  return null;
}
