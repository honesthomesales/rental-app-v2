"use client";

import { useEffect, useState } from "react";
import type { PublicCommunicationsFeatures } from "@/lib/communications/public-features";

const DISABLED: PublicCommunicationsFeatures = {
  tenantCommunicationsEnabled: false,
  communicationsProviderEnabled: false,
  draftGeneratorEnabled: false,
  scheduledSendsEnabled: false,
};

/**
 * Loads safe communications feature flags from the authenticated session.
 * Defaults to disabled until the session response arrives.
 */
export function useCommunicationsFeatures() {
  const [features, setFeatures] =
    useState<PublicCommunicationsFeatures>(DISABLED);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/auth/session", {
          credentials: "include",
          cache: "no-store",
        });
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        const next = data?.features;
        if (next && typeof next === "object") {
          setFeatures({
            tenantCommunicationsEnabled: Boolean(
              next.tenantCommunicationsEnabled,
            ),
            communicationsProviderEnabled: Boolean(
              next.communicationsProviderEnabled,
            ),
            draftGeneratorEnabled: Boolean(next.draftGeneratorEnabled),
            scheduledSendsEnabled: Boolean(next.scheduledSendsEnabled),
          });
        }
      } catch {
        /* keep disabled defaults */
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { features, loaded };
}
