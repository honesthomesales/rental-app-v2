"use client";

import { usePathname } from "next/navigation";
import { Navigation } from "@/components/Navigation";
import PWAInstaller from "@/components/PWAInstaller";
import { AuthProvider } from "@/components/auth/AuthProvider";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLogin = pathname === "/login" || pathname.startsWith("/login/");

  return (
    <AuthProvider>
      <div className="min-h-screen bg-gray-50">
        {!isLogin ? <Navigation /> : null}
        <main className="flex-1 min-w-0 overflow-x-hidden pb-8">
          {children}
        </main>
        {!isLogin ? <PWAInstaller /> : null}
      </div>
    </AuthProvider>
  );
}
