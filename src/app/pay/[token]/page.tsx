import {
  isTenantPaymentPortalEnabled,
} from "@/lib/payments/feature-flags";
import TenantPayClient from "@/components/portal/TenantPayClient";

type PageProps = {
  params: Promise<{ token: string }>;
};

export default async function TenantPayPage({ params }: PageProps) {
  const { token } = await params;
  const enabled = isTenantPaymentPortalEnabled();

  if (!enabled) {
    return (
      <div className="min-h-screen bg-gray-50 px-4 py-8">
        <div className="mx-auto max-w-lg rounded-lg border border-amber-200 bg-amber-50 px-4 py-4 text-sm text-amber-900">
          Online payments are not activated yet.
        </div>
      </div>
    );
  }

  return <TenantPayClient token={token} />;
}
