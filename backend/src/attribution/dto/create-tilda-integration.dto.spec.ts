import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
import {
  CreateTildaIntegrationDto,
  normalizeTildaDomain,
} from "./create-tilda-integration.dto";

describe("CreateTildaIntegrationDto", () => {
  it.each([
    ["bysola.ru", "bysola.ru"],
    ["https://bysola.ru/", "bysola.ru"],
    ["http://bysola.ru", "bysola.ru"],
    ["https://www.bysola.ru/", "bysola.ru"],
    ["https://bysola.ru/shop/product", "bysola.ru"],
    ["https://bysola.ru/shop?utm_source=test", "bysola.ru"],
    [" https://bysola.ru/ ", "bysola.ru"],
    ["HTTPS://BYSOLA.RU/", "bysola.ru"],
    ["http://shop.bysola.ru/catalog", "shop.bysola.ru"],
  ])("normalizes %s to %s", (input, expected) => {
    expect(normalizeTildaDomain(input)).toBe(expected);
  });

  it.each([
    "not a url",
    "https://",
    "ftp://bysola.ru",
    "localhost",
    "http://localhost/shop",
    "127.0.0.1",
    "https://127.0.0.1/shop",
    "http://[::1]",
    "example",
    "https://user:password@bysola.ru",
    "https://bysola.ru:8443",
  ])("rejects %s with a human-readable message", async (domain) => {
    const dto = plainToInstance(CreateTildaIntegrationDto, {
      domain,
      cloudPaymentsPublicId: "pk_test",
      cloudPaymentsApiSecret: "test-secret",
    });

    const errors = await validate(dto);

    expect(errors[0]?.constraints?.matches).toBe(
      "Укажите публичный адрес сайта, например bysola.ru или https://bysola.ru/",
    );
    expect(JSON.stringify(errors)).not.toMatch(/regular expression|DOMAIN_PATTERN/i);
  });
});
