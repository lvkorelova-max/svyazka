import { TildaIntegrationService } from "./tilda-integration.service";

describe("TildaIntegrationService monetary diagnostic", () => {
  it("logs one sanitized monetary capture without PII or raw mixed values", () => {
    const config = {
      get: jest.fn((key: string) =>
        key === "STAGE8_TILDA_MONETARY_DIAGNOSTIC_ENABLED"
          ? "true"
          : undefined,
      ),
    };
    const service = new TildaIntegrationService(
      {} as never,
      config as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const log = jest.fn();
    Object.defineProperty(service, "logger", { value: { log } });

    const capture = (
      service as unknown as {
        captureMonetaryDiagnostic: (
          integrationId: string,
          payload: Record<string, unknown>,
        ) => void;
      }
    ).captureMonetaryDiagnostic.bind(service);
    const payload = {
      payment: {
        amount: "285.75",
        delivery:
          "CDEK delivery: 185.75 RUB; phone +7 999 123-45-67; Street 10",
        currency: "RUB",
      },
      shippingPhone: "+7 999 123-45-67",
      deliveryAddress: "Customer Street 10",
      email: "customer@example.test",
      productDescription: "Private product description",
    };

    capture("integration-1", payload);
    capture("integration-1", { total: "999.00" });

    expect(log).toHaveBeenCalledTimes(1);
    const diagnostic = JSON.parse(log.mock.calls[0][0]);
    expect(diagnostic).toEqual({
      event: "stage8_tilda_monetary_diagnostic",
      integrationId: "integration-1",
      fields: [
        { path: "payment.amount", value: "285.75" },
        {
          path: "payment.delivery",
          value: {
            type: "mixed",
            monetaryValues: ["185.75 RUB"],
            length: 60,
          },
        },
        { path: "payment.currency", value: "RUB" },
      ],
    });
    expect(log.mock.calls[0][0]).not.toMatch(
      /customer|street|999|example|private product/i,
    );
  });
});
