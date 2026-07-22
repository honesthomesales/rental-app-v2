import {
  isTenantPaymentsEnabled,
  isTenantPaymentsLiveMoneyEnabled,
} from "@/lib/payments/feature-flags";

type PageProps = {
  params: Promise<{ token: string }>;
};

/**
 * Tenant-facing payment page (flags default OFF).
 * Shows placeholders only; does not charge money until live-money flag is on.
 */
export default async function TenantPayPage({ params }: PageProps) {
  const { token } = await params;
  const enabled = isTenantPaymentsEnabled();
  const liveMoney = isTenantPaymentsLiveMoneyEnabled();
  const canPay = enabled && liveMoney;

  return (
    <div className="min-h-screen bg-gray-50 px-4 py-8">
      <div className="mx-auto max-w-lg rounded-lg border border-gray-200 bg-white shadow-sm">
        <div className="border-b border-gray-200 px-5 py-4">
          <h1 className="text-xl font-semibold text-gray-900">Pay Rent Online</h1>
          <p className="mt-1 text-sm text-gray-600">
            Secure tenant payment page
          </p>
        </div>

        <div className="space-y-5 px-5 py-5">
          {!enabled && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              Online payments are not activated yet.
            </div>
          )}

          {enabled && !liveMoney && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-3 text-sm text-amber-900">
              Online payments are not activated yet.
            </div>
          )}

          <section>
            <h2 className="text-sm font-semibold text-gray-800">Account</h2>
            <dl className="mt-2 space-y-1 text-sm text-gray-700">
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Tenant</dt>
                <dd>—</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Property</dt>
                <dd>—</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Reference</dt>
                <dd className="truncate font-mono text-xs text-gray-600">
                  {token || "—"}
                </dd>
              </div>
            </dl>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-gray-800">Balances</h2>
            <dl className="mt-2 space-y-1 text-sm text-gray-700">
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Current balance</dt>
                <dd>$0.00</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-gray-500">Past due</dt>
                <dd>$0.00</dd>
              </div>
            </dl>
          </section>

          <section>
            <h2 className="text-sm font-semibold text-gray-800">
              Payment methods
            </h2>
            <ul className="mt-2 space-y-2 text-sm text-gray-700">
              <li className="rounded-md border border-gray-200 px-3 py-2 text-gray-500">
                Debit / credit card — unavailable
              </li>
              <li className="rounded-md border border-gray-200 px-3 py-2 text-gray-500">
                Bank account (ACH) — unavailable
              </li>
              <li className="rounded-md border border-gray-200 px-3 py-2 text-gray-500">
                Cash App Pay — unavailable
              </li>
            </ul>
          </section>

          <button
            type="button"
            disabled={!canPay}
            className="w-full rounded-md bg-blue-600 px-4 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {canPay ? "Continue to payment" : "Payments disabled"}
          </button>
        </div>
      </div>
    </div>
  );
}
