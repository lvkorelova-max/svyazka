import { ServiceUnavailableException } from '@nestjs/common';

/** Applies only at initial offer creation. Existing accepted versions are immutable. */
export function brandPayoutDefault(raw: string | undefined, brandId: string): number | undefined {
  if (!raw?.trim()) return undefined;
  try {
    const values: unknown = JSON.parse(raw);
    if (values === null || typeof values !== 'object' || Array.isArray(values)) throw new Error();
    for (const [id, value] of Object.entries(values)) {
      if (!/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id) ||
          typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error();
    }
    return Object.hasOwn(values, brandId) ? (values as Record<string, number>)[brandId] : undefined;
  } catch {
    throw new ServiceUnavailableException('Настройка порога выплаты бренда недоступна');
  }
}
