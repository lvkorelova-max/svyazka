import { BadRequestException } from '@nestjs/common';

export type CsvRecord = Record<string, string>;

export function parseCsv(buffer: Buffer): CsvRecord[] {
  const text = buffer.toString('utf8').replace(/^\uFEFF/, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field.replace(/\r$/, ''));
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += char;
    }
  }
  if (quoted) throw new BadRequestException('CSV содержит незакрытое поле в кавычках');
  if (field.length || row.length) {
    row.push(field.replace(/\r$/, ''));
    rows.push(row);
  }
  if (rows.length < 2) throw new BadRequestException('CSV не содержит строк заказов');

  const headers = rows[0].map((value) => value.trim().toLowerCase());
  const required = ['external_order_id', 'order_date', 'amount_kopecks', 'currency', 'status'];
  const missing = required.filter((header) => !headers.includes(header));
  if (missing.length) {
    throw new BadRequestException(`В CSV отсутствуют поля: ${missing.join(', ')}`);
  }
  if (new Set(headers).size !== headers.length) {
    throw new BadRequestException('CSV содержит повторяющиеся заголовки');
  }

  return rows
    .slice(1)
    .filter((values) => values.some((value) => value.trim()))
    .map((values) =>
      Object.fromEntries(headers.map((header, index) => [header, (values[index] ?? '').trim()])),
    );
}
