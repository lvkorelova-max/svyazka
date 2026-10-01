import { Transform } from "class-transformer";
import { IsString, Length, Matches } from "class-validator";

const DOMAIN_PATTERN =
  /^(?=.{1,255}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const DOMAIN_ERROR =
  "Укажите публичный адрес сайта, например bysola.ru или https://bysola.ru/";

export function normalizeTildaDomain(value: unknown) {
  const input = String(value ?? "").trim();
  if (!input) return input;

  try {
    const hasProtocol = /^[a-z][a-z\d+.-]*:\/\//i.test(input);
    const url = new URL(
      hasProtocol ? input : `https://${input}`,
    );
    if (!["http:", "https:"].includes(url.protocol)) return input;
    if (url.username || url.password || url.port) return input;
    const hostname = url.hostname.toLowerCase().replace(/\.$/, "");
    return hostname.startsWith("www.") ? hostname.slice(4) : hostname;
  } catch {
    return input;
  }
}

export class CreateTildaIntegrationDto {
  @Transform(({ value }) => normalizeTildaDomain(value))
  @IsString()
  @Matches(DOMAIN_PATTERN, {
    message: DOMAIN_ERROR,
  })
  domain!: string;

  @IsString()
  @Length(4, 160)
  cloudPaymentsPublicId!: string;

  @IsString()
  @Length(8, 500)
  cloudPaymentsApiSecret!: string;
}
