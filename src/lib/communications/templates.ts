import type { TemplateContext, TemplateKey } from "./types";

export type MessageTemplate = {
  key: TemplateKey;
  label: string;
  body: string;
  requiresManualReview?: boolean;
};

export const MESSAGE_TEMPLATES: MessageTemplate[] = [
  {
    key: "rent_due_reminder",
    label: "Rent Due Reminder",
    body: "Hi {{tenant_name}}, this is a reminder that rent of {{amount_due}} for {{property_address}} is due on {{due_date}}. Thank you.",
  },
  {
    key: "late_payment_reminder",
    label: "Late Payment Reminder",
    body: "Hi {{tenant_name}}, our records show rent for {{property_address}} is past due. Amount due: {{amount_due}}. Please contact us to arrange payment.",
  },
  {
    key: "payment_received",
    label: "Payment Received",
    body: "Hi {{tenant_name}}, we received your payment of {{payment_amount}} for {{property_address}}. Thank you.",
  },
  {
    key: "promise_to_pay",
    label: "Promise to Pay Confirmation",
    body: "Hi {{tenant_name}}, this confirms your promise to pay {{amount_due}} for {{property_address}} by {{promise_date}}. Thank you.",
  },
  {
    key: "eviction_process_notice",
    label: "Eviction Process Notice",
    body: "Hi {{tenant_name}}, this message concerns the eviction process for {{property_address}}. Please contact us promptly to discuss next steps. This is not an automated legal notice.",
    requiresManualReview: true,
  },
  {
    key: "custom",
    label: "Custom Message",
    body: "",
  },
];

export function getTemplate(key: TemplateKey): MessageTemplate | undefined {
  return MESSAGE_TEMPLATES.find((t) => t.key === key);
}

export function renderTemplate(
  body: string,
  context: TemplateContext,
): string {
  const values: Record<string, string> = {
    tenant_name: context.tenant_name ?? "",
    property_address: context.property_address ?? "",
    amount_due: context.amount_due ?? "",
    due_date: context.due_date ?? "",
    payment_amount: context.payment_amount ?? "",
    promise_date: context.promise_date ?? "",
    // Stripe phase later — keep empty / marked unavailable
    payment_link:
      context.payment_link && context.payment_link.trim()
        ? context.payment_link
        : "[payment link unavailable]",
  };

  return body.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    return Object.prototype.hasOwnProperty.call(values, key)
      ? values[key]
      : "";
  });
}

export function smsSegmentInfo(body: string): {
  characters: number;
  segments: number;
} {
  const characters = Array.from(body || "").length;
  // GSM-7 approx; treat as UCS-2-safe 70/160 for planning only
  const isGsm = /^[\x20-\x7E\n\r]*$/.test(body || "");
  const single = isGsm ? 160 : 70;
  const multi = isGsm ? 153 : 67;
  if (characters === 0) return { characters: 0, segments: 0 };
  if (characters <= single) return { characters, segments: 1 };
  return { characters, segments: Math.ceil(characters / multi) };
}

/** Outside 8am–8pm America/New_York */
export function isOutsideDaytimeHours(
  now: Date = new Date(),
  timeZone = "America/New_York",
): boolean {
  const hourStr = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    hour12: false,
  }).format(now);
  const hour = parseInt(hourStr, 10);
  return hour < 8 || hour >= 20;
}
