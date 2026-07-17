import type { SmsProvider, SmsSendRequest, SmsSendResult } from "./types";

/**
 * In-memory mock SMS provider for tests and local development.
 * Never performs network I/O.
 */
export class MockSmsProvider implements SmsProvider {
  readonly name = "mock";
  readonly sent: SmsSendRequest[] = [];
  private failNext = false;
  private counter = 0;

  isConfigured(): boolean {
    return true;
  }

  forceFailNext(): void {
    this.failNext = true;
  }

  async send(request: SmsSendRequest): Promise<SmsSendResult> {
    if (this.failNext) {
      this.failNext = false;
      return {
        success: false,
        provider: this.name,
        errorCode: "MOCK_FAILURE",
        errorMessage: "Mock provider forced failure",
      };
    }
    this.counter += 1;
    this.sent.push({ ...request });
    return {
      success: true,
      provider: this.name,
      providerMessageId: `mock_${this.counter}_${Date.now()}`,
    };
  }
}
