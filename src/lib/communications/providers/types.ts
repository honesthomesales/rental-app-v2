export type SmsSendRequest = {
  to: string;
  body: string;
  /** Optional idempotency key for provider-level dedupe */
  idempotencyKey?: string;
};

export type SmsSendResult = {
  success: boolean;
  provider: string;
  providerMessageId?: string;
  errorCode?: string;
  errorMessage?: string;
};

export interface SmsProvider {
  readonly name: string;
  isConfigured(): boolean;
  send(request: SmsSendRequest): Promise<SmsSendResult>;
}
