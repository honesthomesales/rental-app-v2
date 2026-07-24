"use client";

import { usePathname } from "next/navigation";
import { Navigation } from "@/components/Navigation";
import PWAInstaller from "@/components/PWAInstaller";
import { AuthProvider } from "@/components/auth/AuthProvider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login" || pathname.startsWith("/login/");
  const isTenantPortal = pathname === "/pay" || pathname.startsWith("/pay/");
  const hideStaffChrome = isLogin || isTenantPortal;

  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-50">
        {!hideStaffChrome ? <Navigation /> : null}
        <main className="app-shell-main flex-1 min-w-0 max-w-full w-full pb-8">
          {children}
        </main>
        {!hideStaffChrome ? <PWAInstaller /> : null}
      </div>
    </AuthProvider>
  );
}
