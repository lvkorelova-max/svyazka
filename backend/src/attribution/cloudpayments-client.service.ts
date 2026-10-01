import { Injectable, UnauthorizedException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";

type CloudPaymentsTransaction = {
  TransactionId?: number | string;
  InvoiceId?: string;
  Status?: string;
  Amount?: number | string;
  Currency?: string;
  PaymentAmount?: number | string;
  PaymentCurrency?: string;
};

type CloudPaymentsResponse = {
  Success?: boolean;
  Message?: string;
  Model?: CloudPaymentsTransaction | null;
};

type CloudPaymentsNotificationSettingsResponse = {
  Success?: boolean;
  Message?: string;
  Model?: {
    IsEnabled?: boolean;
    Address?: string;
    HttpMethod?: string;
    Encoding?: string;
    Format?: string;
  } | null;
};

@Injectable()
export class CloudPaymentsClient {
  constructor(private readonly config: ConfigService) {}

  async verifyCredentials(publicId: string, apiSecret: string) {
    await this.findPayment(
      publicId,
      apiSecret,
      `svyazka_connection_check_${Date.now()}`,
    );
    return true;
  }

  async findPayment(
    publicId: string,
    apiSecret: string,
    invoiceId: string,
  ): Promise<CloudPaymentsResponse> {
    const baseUrl = (
      this.config.get<string>("CLOUDPAYMENTS_API_BASE_URL") ??
      "https://api.cloudpayments.ru/v2"
    ).replace(/\/+$/, "");
    const response = await fetch(`${baseUrl}/payments/find`, {
      method: "POST",
      headers: {
        authorization: `Basic ${Buffer.from(`${publicId}:${apiSecret}`).toString("base64")}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ InvoiceId: invoiceId }).toString(),
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException(
        "Не удалось подтвердить ключи CloudPayments",
      );
    }
    if (!response.ok) {
      throw new Error(`CLOUDPAYMENTS_UNAVAILABLE_${response.status}`);
    }
    const result = (await response.json()) as CloudPaymentsResponse;
    return result;
  }

  async getNotificationSettings(
    publicId: string,
    apiSecret: string,
    type: string,
  ): Promise<CloudPaymentsNotificationSettingsResponse> {
    const baseUrl = (
      this.config.get<string>("CLOUDPAYMENTS_API_BASE_URL") ??
      "https://api.cloudpayments.ru/v2"
    ).replace(/\/+$/, "");
    const apiRoot = baseUrl.replace(/\/v2$/, "");
    const response = await fetch(
      `${apiRoot}/site/notifications/${encodeURIComponent(type.toLowerCase())}/get`,
      {
        method: "POST",
        headers: {
          authorization: `Basic ${Buffer.from(`${publicId}:${apiSecret}`).toString("base64")}`,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: "",
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (response.status === 401 || response.status === 403) {
      throw new UnauthorizedException(
        "Не удалось подтвердить ключи CloudPayments",
      );
    }
    if (!response.ok) {
      throw new Error(`CLOUDPAYMENTS_UNAVAILABLE_${response.status}`);
    }
    return (await response.json()) as CloudPaymentsNotificationSettingsResponse;
  }
}
