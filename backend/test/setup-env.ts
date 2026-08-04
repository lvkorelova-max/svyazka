import { parse } from 'dotenv';
import { readFileSync } from 'fs';
import { resolve } from 'path';

let localEnv: Record<string, string> = {};
try {
  localEnv = parse(readFileSync(resolve(__dirname, '../../.env')));
} catch {
  localEnv = {};
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://svyazka:local_test_password@localhost:5432/svyazka_test?schema=public';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? 'test_only_access_secret_at_least_32_chars';
process.env.FRONTEND_ORIGIN = process.env.FRONTEND_ORIGIN ?? 'http://localhost:5173';
process.env.COOKIE_SECURE = 'false';
process.env.COOKIE_SAME_SITE = 'lax';
process.env.REFRESH_COOKIE_NAME = 'svyazka_refresh_test';
process.env.PLATFORM_COMMISSION_BPS = '500';
process.env.PUBLIC_BACKEND_URL = 'http://localhost:3000';
process.env.CLICK_IP_HASH_SALT = 'test_only_click_ip_salt_at_least_32_chars';
process.env.CLICK_RATE_LIMIT_PER_MINUTE = '60';
process.env.CLICK_DEDUPE_WINDOW_SECONDS = '5';
process.env.COMMISSION_HOLD_DAYS = '14';
process.env.ADMIN_MFA_REQUIRED = 'false';
process.env.PASSWORD_RESET_EXPOSE_TOKEN = 'true';
process.env.MFA_ENCRYPTION_KEY = 'test_only_mfa_encryption_key_at_least_32_chars';
process.env.MFA_RECOVERY_CODE_SALT = 'test_only_recovery_code_salt_at_least_32_chars';
process.env.S3_ENDPOINT_INTERNAL =
  process.env.S3_ENDPOINT_INTERNAL ?? 'http://localhost:9000';
process.env.S3_ENDPOINT_PUBLIC =
  process.env.S3_TEST_ENDPOINT_PUBLIC ??
  process.env.S3_ENDPOINT_INTERNAL;
process.env.S3_REGION =
  process.env.S3_REGION ?? localEnv.S3_REGION ?? 'us-east-1';
process.env.S3_ACCESS_KEY =
  process.env.S3_ACCESS_KEY ?? localEnv.S3_ACCESS_KEY ?? 'svyazka_minio';
process.env.S3_SECRET_KEY =
  process.env.S3_SECRET_KEY ??
  localEnv.S3_SECRET_KEY ??
  'local_minio_secret_change_me';
process.env.S3_BUCKET =
  process.env.S3_BUCKET ?? localEnv.S3_BUCKET ?? 'creator-kit';
process.env.S3_UPLOAD_URL_TTL_SECONDS = '600';
process.env.S3_DOWNLOAD_URL_TTL_SECONDS = '300';
process.env.CREATOR_KIT_MAX_ASSETS = '100';
process.env.CREATOR_KIT_MAX_IMAGE_BYTES = '26214400';
process.env.CREATOR_KIT_MAX_VIDEO_BYTES = '524288000';
process.env.CREATOR_KIT_MAX_DOCUMENT_BYTES = '26214400';
