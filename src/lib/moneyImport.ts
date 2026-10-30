import { currency, isCurrency } from './currencies';

/**
 * «Деньги»: чтение банковских выписок любой страны — без ИИ, где формат
 * известен: OFX/QFX, QIF, CAMT.053 (ISO 20022), MT940 (SWIFT) и таблицы
 * CSV/xlsx (столбцы узнаём по заголовкам; не узнали — спросит ИИ один раз,
 * дальше шаблон банка). PDF и скриншоты читает ИИ (src/server/moneyImport.ts).
 */

/** Строка выписки. Сумма со знаком: минус — списание. */
export interface RawTx {
  day: string;
  amount_minor: number;
  currency: string | null;
  description: string;
  /** Id операции у банка (FITID, AcctSvcrRef…) — лучший ключ от повторов. */
  ext_id?: string;
  /** Категория банка — подсказка для своей. */
  bank_category?: string;
  /** Сумма в валюте покупки, если она другая (у Т-Банка — «Сумма операции»). */
  orig_amount_minor?: number;
  orig_currency?: string;
}

export interface ParsedStatement {
  format: string;
  bank?: string;
  /** Валюта выписки (счёта), если она указана. */
  currency?: string | null;
  /** Номер счёта из выписки — чтобы в следующий раз выбрать тот же счёт. */
  account_ref?: string;
  txs: RawTx[];
}

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Текст файла: UTF-8 (с BOM или без), UTF-16 или Windows-1251 — так выгружают многие российские банки. */
export function decodeText(buf: Uint8Array): string {
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf);
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf);
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
  } catch {
    return new TextDecoder('windows-1251').decode(buf);
  }
}

const toMinor = (n: number, code: string | null) => Math.round(n * 10 ** (code && isCurrency(code) ? currency(code).digits : 2));

/**
 * Сумма из выписки → число со знаком: «-1 234,56», «1,234.56», «(12.00)»,
 * «−500 ₽», «1.234,56 EUR», «+120 000». Не сумма — null.
 */
export function parseSigned(raw: unknown): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (typeof raw !== 'string') return null;
  let s = raw.trim().replace(/[    ']/g, '');
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) {
    neg = true;
    s = s.slice(1, -1);
  }
  s = s.replace(/[−–—]/g, '-');
  // Минус до первой цифры («-500», «€-12») или в конце («500-», как в некоторых выписках).
  if (s.slice(0, Math.max(0, s.search(/\d/))).includes('-') || /-$/.test(s)) neg = !neg;
  s = s.replace(/[^\d.,]/g, '');
  if (!/\d/.test(s)) return null;
  const lastDot = s.lastIndexOf('.');
  const lastComma = s.lastIndexOf(',');
  if (lastDot >= 0 && lastComma >= 0) {
    // Оба знака: десятичный — последний.
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma >= 0) {
    // «1,234» — тысячи, «12,40» и «0,5» — дробь.
    s = (s.match(/,/g)!.length > 1 || /,\d{3}$/.test(s)) && !/^0,/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if ((s.match(/\./g)?.length ?? 0) > 1) s = s.replace(/\./g, '');
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

export type DateOrder = 'dmy' | 'mdy' | 'ymd';

/** Дата строки: «30.10.2026», «30.10.26 18:42», «2026-10-30T…», «10/30/2026» (по порядку order), Excel-число. */
export function parseDay(raw: unknown, order: DateOrder = 'dmy'): string | null {
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    // Excel: дни от 1899-12-30.
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(raw) * 864e5).toISOString().slice(0, 10);
  }
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  let m = /^(\d{4})[-./](\d{1,2})[-./](\d{1,2})/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  m = /^(\d{1,2})[-./](\d{1,2})[-./](\d{2}|\d{4})\b/.exec(s);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return order === 'mdy' ? ymd(y, +m[1], +m[2]) : ymd(y, +m[2], +m[1]);
  }
  m = /^(\d{4})(\d{2})(\d{2})/.exec(s);
  if (m) return ymd(+m[1], +m[2], +m[3]);
  // «30 окт 2026», «30 Oct 2026»
  m = /^(\d{1,2})\s+([a-zа-яё]+)\.?\s+(\d{4})/i.exec(s);
  if (m) {
    const mon = monthIndex(m[2]);
    if (mon) return ymd(+m[3], mon, +m[1]);
  }
  return null;
}

const MONTHS: [RegExp, number][] = [
  [/^(янв|jan)/i, 1],
  [/^(фев|feb)/i, 2],
  [/^(мар|mar)/i, 3],
  [/^(апр|apr)/i, 4],
  [/^(ма[йя]|may)/i, 5],
  [/^(июн|jun)/i, 6],
  [/^(июл|jul)/i, 7],
  [/^(авг|aug)/i, 8],
  [/^(сен|sep)/i, 9],
  [/^(окт|oct)/i, 10],
  [/^(ноя|nov)/i, 11],
  [/^(дек|dec)/i, 12],
];
const monthIndex = (w: string) => MONTHS.find(([re]) => re.test(w))?.[1] ?? 0;

function ymd(y: number, m: number, d: number): string | null {
  if (y < 1990 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return new Date(`${s}T12:00:00Z`).getUTCDate() === d ? s : null;
}

/** День/месяц или месяц/день — по строкам, где одно из чисел больше 12. */
export function guessDateOrder(values: unknown[]): DateOrder {
  let dmy = 0;
  let mdy = 0;
  for (const v of values) {
    const m = typeof v === 'string' ? /^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/.exec(v.trim()) : null;
    if (!m) continue;
    if (+m[1] > 12) dmy++;
    if (+m[2] > 12) mdy++;
  }
  return mdy > dmy ? 'mdy' : 'dmy';
}

const clean = (s: string) => s.replace(/\s+/g, ' ').trim();

// ---------------------------------------------------------------- OFX / QFX

/** OFX 1 (SGML, теги без закрытия) и OFX 2 (XML): STMTTRN → строки. */
export function parseOfx(text: string): ParsedStatement | null {
  if (!/<OFX>/i.test(text)) return null;
  const tag = (block: string, name: string) => new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block)?.[1]?.trim() ?? '';
  const cur = tag(text, 'CURDEF').toUpperCase() || null;
  const txs: RawTx[] = [];
  for (const m of text.matchAll(/<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|<\/BANKTRANLIST>)/gi)) {
    const b = m[1];
    const day = parseDay(tag(b, 'DTPOSTED') || tag(b, 'DTUSER'));
    const amount = parseSigned(tag(b, 'TRNAMT'));
    if (!day || amount === null || amount === 0) continue;
    txs.push({
      day,
      amount_minor: toMinor(amount, cur),
      currency: cur,
      description: clean([tag(b, 'NAME') || tag(b, 'PAYEE'), tag(b, 'MEMO')].filter(Boolean).join(' · ')) || tag(b, 'TRNTYPE'),
      ext_id: tag(b, 'FITID') || undefined,
    });
  }
  return { format: 'OFX', bank: tag(text, 'ORG') || undefined, currency: cur, account_ref: tag(text, 'ACCTID') || undefined, txs };
}

// ---------------------------------------------------------------- QIF

/** QIF (Quicken): D — дата, T/U — сумма, P — получатель, M — заметка, L — категория, ^ — конец записи. */
export function parseQif(text: string): ParsedStatement | null {
  if (!/^!(Type|Account)/im.test(text)) return null;
  const records = text.split(/^\^\s*$/m);
  const dates = records.map((r) => /^D(.+)$/m.exec(r)?.[1]?.replace(/'/g, '/') ?? '');
  const order = guessDateOrder(dates);
  const txs: RawTx[] = [];
  records.forEach((r, i) => {
    const day = parseDay(dates[i], order);
    const amount = parseSigned(/^[TU](.+)$/m.exec(r)?.[1] ?? '');
    if (!day || !amount) return;
    const p = /^P(.+)$/m.exec(r)?.[1]?.trim() ?? '';
    const memo = /^M(.+)$/m.exec(r)?.[1]?.trim() ?? '';
    txs.push({ day, amount_minor: toMinor(amount, null), currency: null, description: clean([p, memo].filter(Boolean).join(' · ')), bank_category: /^L(.+)$/m.exec(r)?.[1]?.trim() || undefined });
  });
  return { format: 'QIF', currency: null, txs };
}

// ---------------------------------------------------------------- CAMT.053

const xmlText = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

/** CAMT.053 (ISO 20022, банки Европы и не только): Ntry → строки. Префиксы пространств имён не важны. */
export function parseCamt(text: string): ParsedStatement | null {
  if (!/<(\w+:)?BkToCstmrStmt\b/.test(text)) return null;
  const first = (b: string, path: string[]): string => {
    let cur = b;
    for (const p of path) {
      const m = new RegExp(`<(?:\\w+:)?${p}\\b[^>]*>([\\s\\S]*?)</(?:\\w+:)?${p}>`).exec(cur);
      if (!m) return '';
      cur = m[1];
    }
    return xmlText(cur).trim();
  };
  const acct = first(text, ['Acct', 'Id', 'IBAN']) || first(text, ['Acct', 'Id', 'Othr', 'Id']);
  const stmtCur = /<(?:\w+:)?Acct\b[\s\S]*?<(?:\w+:)?Ccy>([A-Z]{3})</.exec(text)?.[1] ?? null;
  const txs: RawTx[] = [];
  for (const m of text.matchAll(/<(?:\w+:)?Ntry\b[^>]*>([\s\S]*?)<\/(?:\w+:)?Ntry>/g)) {
    const b = m[1];
    const amt = /<(?:\w+:)?Amt\b[^>]*Ccy="([A-Z]{3})"[^>]*>([\d.]+)</.exec(b);
    if (!amt) continue;
    const debit = first(b, ['CdtDbtInd']) === 'DBIT';
    const day = parseDay(first(b, ['BookgDt', 'Dt']) || first(b, ['BookgDt', 'DtTm']) || first(b, ['ValDt', 'Dt']));
    if (!day) continue;
    const party = debit ? first(b, ['Cdtr', 'Nm']) || first(b, ['Cdtr', 'Pty', 'Nm']) : first(b, ['Dbtr', 'Nm']) || first(b, ['Dbtr', 'Pty', 'Nm']);
    const info = [...b.matchAll(/<(?:\w+:)?Ustrd>([\s\S]*?)<\/(?:\w+:)?Ustrd>/g)].map((x) => xmlText(x[1]).trim()).join(' ');
    const n = Number(amt[2]);
    txs.push({
      day,
      amount_minor: toMinor(debit ? -n : n, amt[1]),
      currency: amt[1],
      description: clean([party, info || first(b, ['AddtlNtryInf'])].filter(Boolean).join(' · ')),
      ext_id: first(b, ['AcctSvcrRef']) || first(b, ['NtryRef']) || undefined,
    });
  }
  return { format: 'CAMT.053', currency: stmtCur, account_ref: acct || undefined, txs };
}

// ---------------------------------------------------------------- MT940

/** MT940 (SWIFT): :61: — проводка (ГГММДД[ММДД] C/D сумма), :86: — описание к ней, :60F: — валюта. */
export function parseMt940(text: string): ParsedStatement | null {
  if (!/:20:/.test(text) || !/:61:/.test(text)) return null;
  const cur = /:60[FM]:[CD]\d{6}([A-Z]{3})/.exec(text)?.[1] ?? null;
  const acct = /:25:([^\r\n]+)/.exec(text)?.[1]?.trim();
  const fields = text.split(/\r?\n(?=:\d{2}[A-Z]?:)/);
  const txs: RawTx[] = [];
  for (let i = 0; i < fields.length; i++) {
    const m = /^:61:(\d{2})(\d{2})(\d{2})(\d{4})?(R?[CD])([A-Z])?([\d,]+)(\w{4})?([^\r\n]*)/.exec(fields[i]);
    if (!m) continue;
    const day = ymd(2000 + +m[1], +m[2], +m[3]);
    const n = Number(m[7].replace(',', '.'));
    if (!day || !n) continue;
    // RC/RD — сторно: знак наоборот.
    const debit = m[5] === 'D' || m[5] === 'RC';
    const ref = m[9].split('//');
    const next = fields[i + 1]?.startsWith(':86:') ? fields[i + 1].slice(4).replace(/\r?\n/g, '') : '';
    // :86: бывает структурным (?20…?29 — назначение, ?32/?33 — имя).
    const desc = next.includes('?')
      ? clean([next.match(/\?3[23]([^?]*)/g)?.map((x) => x.slice(3)).join(''), next.match(/\?2\d([^?]*)/g)?.map((x) => x.slice(3)).join('')].filter(Boolean).join(' · '))
      : clean(next);
    txs.push({ day, amount_minor: toMinor(debit ? -n : n, cur), currency: cur, description: desc || clean(ref[0]), ext_id: ref[1]?.trim() || undefined });
  }
  return { format: 'MT940', currency: cur, account_ref: acct, txs };
}

// ---------------------------------------------------------------- таблицы

/** CSV с любым разделителем (, ; таб |) и кавычками. */
export function parseCsv(text: string): string[][] {
  const sample = text.split(/\r?\n/).slice(0, 20).join('\n');
  const counts = [',', ';', '\t', '|'].map((d) => [d, sample.split(d).length] as const);
  const delim = counts.sort((a, b) => b[1] - a[1])[0][0];
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"' && text[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell);
      if (row.some((c) => c.trim())) rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows.map((r) => r.map((c) => c.trim()));
}

/** Какой столбец таблицы что значит. Номера — с нуля. */
export interface TableMapping {
  header_row: number;
  date: number;
  /** Сумма со знаком… */
  amount?: number;
  /** …или два столбца: списания и поступления (оба положительные). */
  debit?: number;
  credit?: number;
  /** Суммы без знака, а списание видно по отдельному столбцу (например, «Тип»: Debit/Credit). */
  direction?: number;
  currency?: number;
  description: number[];
  category?: number;
  id?: number;
  status?: number;
  orig_amount?: number;
  orig_currency?: number;
  date_order?: DateOrder;
  /** Траты в столбце amount — положительные (так у некоторых кредиток). */
  invert?: boolean;
  bank?: string;
}

type Cell = string | number | null;

const H = {
  date: [/^дата( и время)? операции/, /^дата( и время)? транзакции/, /^дата проводки/, /^дата$/, /^completed date/, /^transaction date/, /^booking date/, /^date/, /^buchungstag/, /^datum/, /^fecha/, /^дата/],
  amount: [/^сумма платежа/, /^сумма в валюте сч[её]та/, /^сумма операции в валюте карты/, /^сумма$/, /^сумма операции/, /^amount$/, /^amount/, /^betrag/, /^importe/, /^сумма/],
  debit: [/^расход/, /^списани/, /^дебет/, /^debit/, /^paid out/, /^withdrawal/, /^money out/, /^soll/],
  credit: [/^приход/, /^поступлени/, /^зачислени/, /^кредит/, /^credit/, /^paid in/, /^deposit/, /^money in/, /^haben/],
  currency: [/^валюта платежа/, /^валюта сч[её]та/, /^валюта$/, /^currency/, /^währung/, /^валюта/],
  orig_amount: [/^сумма операции$/, /^сумма в валюте операции/, /^original amount/],
  orig_currency: [/^валюта операции/, /^original currency/],
  description: [/^описание/, /^назначение/, /^description/, /^details/, /^merchant/, /^payee/, /^получатель/, /^контрагент/, /^наименование/, /^verwendungszweck/, /^beg[üu]nstigter/, /^name/, /^reference/, /^memo/, /^комментарий/],
  category: [/^категория/, /^category/],
  id: [/^(id|transaction id|номер операции|reference number)$/],
  status: [/^статус/, /^status/, /^state$/],
  direction: [/^(тип|type|направление|cr\/dr|debit\/credit)$/],
};

function findCol(header: string[], pats: RegExp[], taken: Set<number>): number | undefined {
  for (const p of pats) {
    const i = header.findIndex((h, j) => !taken.has(j) && p.test(h));
    if (i >= 0) return i;
  }
  return undefined;
}

/** Столбцы по заголовкам (русские, английские, немецкие, испанские). Не нашли дату, сумму и описание — null. */
export function detectMapping(rows: Cell[][]): TableMapping | null {
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const header = rows[r].map((c) => String(c ?? '').toLowerCase().replace(/\s+/g, ' ').trim());
    const taken = new Set<number>();
    const take = (pats: RegExp[]) => {
      const i = findCol(header, pats, taken);
      if (i !== undefined) taken.add(i);
      return i;
    };
    const date = take(H.date);
    if (date === undefined) continue;
    const amount = take(H.amount);
    const orig_amount = amount !== undefined && /платежа|сч[её]та|карты/.test(header[amount]) ? take(H.orig_amount) : undefined;
    const debit = amount === undefined ? take(H.debit) : undefined;
    const credit = amount === undefined ? take(H.credit) : undefined;
    if (amount === undefined && (debit === undefined || credit === undefined)) continue;
    const cur = take(H.currency);
    const orig_currency = orig_amount !== undefined ? take(H.orig_currency) : undefined;
    const category = take(H.category);
    const id = take(H.id);
    const status = take(H.status);
    const direction = take(H.direction);
    const description: number[] = [];
    for (const p of H.description) {
      const i = findCol(header, [p], taken);
      if (i !== undefined) {
        taken.add(i);
        description.push(i);
      }
    }
    if (!description.length) continue;
    return {
      header_row: r,
      date,
      amount,
      debit,
      credit,
      currency: cur,
      orig_amount,
      orig_currency,
      description: description.slice(0, 3),
      category,
      id,
      status,
      direction: amount !== undefined && direction !== undefined ? direction : undefined,
      date_order: guessDateOrder(rows.slice(r + 1, r + 60).map((x) => x[date])),
    };
  }
  return null;
}

/** Подпись таблицы — по заголовкам: у одного банка она одна и та же. */
export function tableSignature(rows: Cell[][], headerRow: number): string {
  return `table:${(rows[headerRow] ?? []).map((c) => String(c ?? '').toLowerCase().trim()).join('|')}`.slice(0, 500);
}

const FAILED = /fail|declin|reject|revert|cancel|отклон|отмен|ошибк|не выполн/i;
const DEBIT_WORD = /^(d|dr|db|debit|дебет|списание|расход|out|-)$/i;

/** Таблица по шаблону → строки выписки. */
export function applyMapping(rows: Cell[][], m: TableMapping, fallbackCurrency: string | null = null): RawTx[] {
  const out: RawTx[] = [];
  const cell = (r: Cell[], i: number | undefined) => (i === undefined ? '' : String(r[i] ?? '').trim());
  for (const r of rows.slice(m.header_row + 1)) {
    const day = typeof r[m.date] === 'number' ? parseDay(r[m.date] as number) : parseDay(cell(r, m.date), m.date_order);
    if (!day) continue;
    if (m.status !== undefined && FAILED.test(cell(r, m.status))) continue;
    let n: number | null;
    if (m.amount !== undefined) {
      n = parseSigned(r[m.amount] ?? '');
      if (n !== null && m.direction !== undefined && DEBIT_WORD.test(cell(r, m.direction))) n = -Math.abs(n);
      if (n !== null && m.invert) n = -n;
    } else {
      const d = parseSigned(r[m.debit!] ?? '') ?? 0;
      const c = parseSigned(r[m.credit!] ?? '') ?? 0;
      n = Math.abs(c) - Math.abs(d);
    }
    if (n === null || n === 0) continue;
    const cur = cell(r, m.currency).toUpperCase().replace('RUR', 'RUB');
    const code = isCurrency(cur) ? cur : fallbackCurrency;
    const tx: RawTx = {
      day,
      amount_minor: toMinor(n, code),
      currency: code,
      description: clean(m.description.map((i) => cell(r, i)).filter(Boolean).join(' · ')),
      bank_category: cell(r, m.category) || undefined,
      ext_id: cell(r, m.id) || undefined,
    };
    const oc = cell(r, m.orig_currency).toUpperCase().replace('RUR', 'RUB');
    const oa = parseSigned(r[m.orig_amount ?? -1] ?? '');
    if (oa && isCurrency(oc) && oc !== code) {
      tx.orig_amount_minor = toMinor(Math.abs(oa), oc);
      tx.orig_currency = oc;
    }
    out.push(tx);
  }
  return out;
}

/** Проверка шаблона от ИИ: номера столбцов в пределах таблицы. */
export function validMapping(raw: unknown, width: number, rowsCount: number): TableMapping | null {
  const m = (raw ?? {}) as Record<string, unknown>;
  const col = (v: unknown) => (Number.isInteger(v) && (v as number) >= 0 && (v as number) < width ? (v as number) : undefined);
  const date = col(m.date);
  const amount = col(m.amount);
  const debit = col(m.debit);
  const credit = col(m.credit);
  const description = Array.isArray(m.description) ? m.description.map(col).filter((x): x is number => x !== undefined).slice(0, 3) : [col(m.description)].filter((x): x is number => x !== undefined);
  const header_row = Number.isInteger(m.header_row) && (m.header_row as number) >= 0 && (m.header_row as number) < rowsCount ? (m.header_row as number) : 0;
  if (date === undefined || (amount === undefined && (debit === undefined || credit === undefined)) || !description.length) return null;
  return {
    header_row,
    date,
    amount,
    debit: amount === undefined ? debit : undefined,
    credit: amount === undefined ? credit : undefined,
    direction: col(m.direction),
    currency: col(m.currency),
    description,
    category: col(m.category),
    id: col(m.id),
    status: col(m.status),
    orig_amount: col(m.orig_amount),
    orig_currency: col(m.orig_currency),
    date_order: m.date_order === 'mdy' || m.date_order === 'ymd' ? m.date_order : 'dmy',
    invert: m.invert === true,
    bank: typeof m.bank === 'string' ? m.bank.slice(0, 60) : undefined,
  };
}

// ---------------------------------------------------------------- после чтения

/** Описание для сравнения: без цифр карт, дат и знаков. */
export function normDesc(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/\d+/g, ' ')
    .replace(/[^\p{L}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60);
}

/**
 * Ключ строки от повторов: id банка, а нет его — день, сумма и описание.
 * Две одинаковые строки в одной выписке (два кофе) — разные ключи (#2).
 */
export function importKeys(txs: Pick<RawTx, 'day' | 'amount_minor' | 'description' | 'ext_id'>[]): string[] {
  const seen = new Map<string, number>();
  return txs.map((t) => {
    if (t.ext_id) return `id:${t.ext_id}`.slice(0, 200);
    const base = `h:${t.day}|${t.amount_minor}|${normDesc(t.description)}`;
    const n = (seen.get(base) ?? 0) + 1;
    seen.set(base, n);
    return n > 1 ? `${base}#${n}` : base;
  });
}

/**
 * Скриншоты одного списка часто перекрываются: одинаковые строки с разных
 * снимков склеиваем, а одинаковые на одном снимке оставляем (два кофе).
 */
export function mergeScreens(pages: RawTx[][]): { txs: RawTx[]; merged: number } {
  const out: RawTx[] = [];
  const counts = new Map<string, number>();
  let merged = 0;
  for (const page of pages) {
    const here = new Map<string, number>();
    for (const t of page) {
      const k = `${t.day}|${t.amount_minor}|${normDesc(t.description)}`;
      const n = (here.get(k) ?? 0) + 1;
      here.set(k, n);
      if (n <= (counts.get(k) ?? 0)) {
        merged++;
        continue;
      }
      counts.set(k, n);
      out.push(t);
    }
  }
  return { txs: out, merged };
}

/** Ответ ИИ по PDF или скриншоту → строки. */
export function parseAiTxs(raw: unknown, today: string): { bank?: string; currency: string | null; account_ref?: string; txs: RawTx[] } {
  const r = (raw ?? {}) as Record<string, unknown>;
  const cur = typeof r.currency === 'string' && isCurrency(r.currency.toUpperCase()) ? r.currency.toUpperCase() : null;
  const txs: RawTx[] = [];
  for (const x of Array.isArray(r.txs) ? r.txs.slice(0, 1000) : []) {
    const t = (x ?? {}) as Record<string, unknown>;
    const day = typeof t.date === 'string' && DAY_RE.test(t.date) && t.date <= today ? t.date : null;
    const n = parseSigned(t.amount);
    if (!day || !n) continue;
    const c = typeof t.currency === 'string' && isCurrency(t.currency.toUpperCase()) ? t.currency.toUpperCase() : cur;
    txs.push({
      day,
      amount_minor: toMinor(n, c),
      currency: c,
      description: clean(String(t.description ?? '')).slice(0, 300),
      bank_category: typeof t.category === 'string' && t.category.trim() ? t.category.trim().slice(0, 60) : undefined,
    });
  }
  return { bank: typeof r.bank === 'string' && r.bank.trim() ? r.bank.trim().slice(0, 60) : undefined, currency: cur, account_ref: typeof r.account === 'string' && r.account.trim() ? r.account.trim().slice(0, 60) : undefined, txs };
}
