import { brandPayoutDefault } from './brand-payout-default';
const bysola = '7fb03a58-8bad-45c4-872b-4d31bf8955da';
const other = '00000001-0000-4000-8000-000000000000';

it('sets the BYSOLA default to 1000 RUB without changing other brands', () => {
  const raw = JSON.stringify({ [bysola]: 100000 });
  expect(brandPayoutDefault(raw, bysola)).toBe(100000);
  expect(brandPayoutDefault(raw, other)).toBeUndefined();
  expect(brandPayoutDefault(undefined, bysola)).toBeUndefined();
});

it.each(['{', '[]', 'null', '{"wrong-brand":100000}',
  JSON.stringify({ [bysola]: -1 }), JSON.stringify({ [bysola]: 1.5 }),
  JSON.stringify({ [bysola]: '100000' })])('rejects invalid configuration %s', raw => {
  expect(() => brandPayoutDefault(raw, bysola)).toThrow('Настройка порога выплаты бренда недоступна');
});
