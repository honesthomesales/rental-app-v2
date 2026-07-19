/**
 * Map Twilio MessageStatus to our communication status.
 */
export function mapTwilioDeliveryStatus(
  messageStatus: string,
): "delivered" | "failed" | "sent" | null {
  const s = String(messageStatus || "").toLowerCase();
  if (s === "delivered") return "delivered";
  if (s === "failed" || s === "undelivered") return "failed";
  if (s === "sent" || s === "queued" || s === "accepted" || s === "sending") {
    return "sent";
  }
  return null;
}
