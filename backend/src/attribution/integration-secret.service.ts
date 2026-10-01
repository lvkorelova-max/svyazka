import { Injectable, ServiceUnavailableException } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "crypto";

@Injectable()
export class IntegrationSecretService {
  constructor(private readonly config: ConfigService) {}

  generate() {
    return randomBytes(32).toString("base64url");
  }

  encrypt(secret: string) {
    const key = this.key();
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([
      cipher.update(secret, "utf8"),
      cipher.final(),
    ]);
    return [
      "v1",
      iv.toString("base64url"),
      cipher.getAuthTag().toString("base64url"),
      ciphertext.toString("base64url"),
    ].join(".");
  }

  decrypt(value: string) {
    const [version, iv, tag, ciphertext] = value.split(".");
    if (version !== "v1" || !iv || !tag || !ciphertext) {
      throw new ServiceUnavailableException(
        "Invalid integration secret format",
      );
    }
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.key(),
      Buffer.from(iv, "base64url"),
    );
    decipher.setAuthTag(Buffer.from(tag, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertext, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  }

  private key() {
    const source = this.config.get<string>(
      "STAGE8_WEBHOOK_SECRET_ENCRYPTION_KEY",
    );
    if (!source || source.length < 32) {
      throw new ServiceUnavailableException(
        "STAGE8_WEBHOOK_SECRET_ENCRYPTION_KEY is not configured",
      );
    }
    return createHash("sha256").update(source).digest();
  }
}
