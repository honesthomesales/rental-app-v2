# OWNER PAYMENT AND BANK RECONCILIATION PACKET
Generated: 2026-07-23
Production URL: https://rental-app-v3.vercel.app/
Do not print secret values.

## Current status
- Code deployed or ready for Stage B with **all flags default OFF**
- Migration `migrations/20260723_tenant_payment_portal.sql` is **additive** and **not applied** until backup/PITR + owner approval
- Auto-post for bank matches is **disabled** by design (`BANK_AUTO_POST_ENABLED`)

---

## Stripe
- [ ] Account verification status: ________
- [ ] Payout account status: ________
- [ ] ACH eligibility: ________
- [ ] Card eligibility: ________
- [ ] Cash App Pay eligibility: ________
- [ ] Test credentials configured in Vercel Preview/Development
- [ ] Live credentials configured in Vercel Production
- [ ] Webhook endpoint: `https://rental-app-v3.vercel.app/api/payments/stripe/webhook`
- [ ] Webhook events selected:
  - checkout.session.completed
  - checkout.session.async_payment_succeeded
  - checkout.session.async_payment_failed
  - checkout.session.expired
  - payment_intent.succeeded
  - payment_intent.payment_failed
  - charge.refunded
  - charge.dispute.created
  - charge.dispute.funds_withdrawn
- [ ] Statement descriptor: ________

### Environment variable names (values via Vercel UI only)
- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY` (if needed for future Elements)
- `STRIPE_WEBHOOK_SIGNING_SECRET`

---

## Existing Cash App
- [ ] Business or personal account type: ________
- [ ] Cashtag / approved payment destination: ________
- [ ] Deposit bank account: ________
- [ ] Deposits individually identified vs batched: ________
- [ ] Unique payment reference can be included in note: ________
- [ ] Refund/dispute policy: ________

Env name:
- `EXISTING_CASH_APP_DESTINATION`

---

## Zelle
- [ ] Business-account eligibility: ________
- [ ] Registered phone or email: ________
- [ ] Receiving bank account: ________
- [ ] Bank limits / fees: ________
- [ ] Description format visible in bank feed: ________
- [ ] Tenant reference appears in transaction details: ________

Env name:
- `EXISTING_ZELLE_DESTINATION`

---

## Secure bank connection (Plaid or approved API)
- [ ] Bank name: ________
- [ ] Deposit account to connect: ________
- [ ] Dedicated vs mixed-use account: ________
- [ ] Plaid / direct API availability: ________
- [ ] Read-only approval: ________
- [ ] Owner/admin users authorized to view imports: ________
- [ ] Data retention policy: ________
- [ ] Token revocation process: ________

Env names:
- `PLAID_CLIENT_ID`
- `PLAID_SECRET`
- `PLAID_ENV` (`sandbox` | `production`)
- `BANK_TOKEN_ENCRYPTION_KEY` (32-byte hex or passphrase; server-only)

---

## Fee decisions
- [ ] ACH fee rule: ________
- [ ] Credit-card fee rule: ________
- [ ] Debit/prepaid fee status: **default OFF / blocked unless explicitly approved**
- [ ] Cash App Pay fee: ________
- [ ] Existing Cash App fee: ________
- [ ] Zelle fee: ________
- [ ] Minimum / maximum: ________
- [ ] Refund treatment: ________
- [ ] Required disclosures: ________
- [ ] Legal/network review status: ________

Flag:
- `PAYMENT_FEE_ENGINE_ENABLED`

---

## Portal decisions
- [ ] Partial payments allowed? (`TENANT_PORTAL_ALLOW_PARTIAL`)
- [ ] Overpayments allowed? (`TENANT_PORTAL_ALLOW_OVERPAY`)
- [ ] First live test tenant: ________
- [ ] First live test amount: ________
- [ ] Contact verification rules: ________
- [ ] Portal auth method: signed revocable token (`/pay/{token}`)
- [ ] Support email: ________ (`TENANT_PORTAL_SUPPORT_EMAIL`)
- [ ] Support phone: ________ (`TENANT_PORTAL_SUPPORT_PHONE`)

---

## Feature flags (all default OFF)
- `TENANT_PAYMENT_PORTAL_ENABLED`
- `TENANT_ACH_ENABLED`
- `TENANT_CARD_ENABLED`
- `TENANT_CASH_APP_PAY_ENABLED`
- `TENANT_EXISTING_CASH_APP_ENABLED`
- `TENANT_ZELLE_ENABLED`
- `PAYMENT_FEE_ENGINE_ENABLED`
- `BANK_RECONCILIATION_ENABLED`
- `BANK_AUTO_MATCH_ENABLED`
- `BANK_AUTO_POST_ENABLED`  ← keep OFF on first release
- `TENANT_CONTACT_SELF_SERVICE_ENABLED`

---

## Database
- [ ] Supabase PITR / backup confirmed for project `gnisgfojzrrnidizrycj`
- [ ] Migration tested in non-production
- [ ] Owner approval to apply `20260723_tenant_payment_portal.sql`
- [ ] Verification + rollback SQL reviewed (`*_ROLLBACK_AND_VERIFY.md`)

---

## Activation order (Stage C)
1. Contact self-service for one test tenant
2. Stripe card (controlled)
3. Stripe ACH
4. Stripe Cash App Pay
5. Existing Cash App instructions + manual reconciliation
6. Zelle instructions + manual reconciliation
7. Read-only bank sync
8. High-confidence auto-match (review only)
9. Auto-post only after separate owner approval

Do not enable auto-post on the first release.
