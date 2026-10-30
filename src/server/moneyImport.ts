import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { opEffect } from '@/lib/money';
import {
  applyMapping,
  decodeText,
  detectMapping,
  importKeys,
  mergeScreens,
  normDesc,
  parseAiTxs,
  parseCamt,
  parseCsv,
  parseMt940,
  parseOfx,
  parseQif,
  tableSignature,
  validMapping,
  type ParsedStatement,
  type RawTx,
  type TableMapping,
} from '@/lib/moneyImport';
import { aiConfigured, askJson, type Part } from './ai';
import { DAY_RE, HttpError } from './http';
import { readAccounts, readCategories, readMoneySettings } from './moneyStore';
import { readXlsx, type XCell } from './xlsxRead';

/**
 * Импорт выписок в «Деньги»: файл (CSV, xlsx, PDF, OFX, QIF, CAMT.053,
 * MT940) или скриншоты → строки с подсказками (кто получатель, категория,
 * перевод ли это себе) → человек смотрит и сохраняет (commit в api/money.ts).
 *
 * Чтение идёт фоном: nginx ждёт ответа 30 с, а длинный PDF ИИ читает дольше.
 * Экран спрашивает результат по номеру задачи.
 */

export interface ImportRow extends RawTx {
  key: string;
  kind: 'expense' | 'income' | 'transfer';
  payee: string;
  category_id: string | null;
  /** Перевод: второй свой счёт. */
  to_account_id: string | null;
  /** Похоже на перевод себе, но не ясно, на какой счёт. */
  transfer_hint: boolean;
}

export interface ImportResult {
  format: string;
  bank: string | null;
  currency: string | null;
  account_ref: string | null;
  signature: string | null;
  mapping: TableMapping | null;
  /** Склеено повторов между скриншотами. */
  merged: number;
  account_id: string | null;
  rows: ImportRow[];
}

const MAX_FILE = 8_000_000;
const MAX_SCREENS = 10;

// ---------------------------------------------------------------- задачи

interface Job {
  userId: string;
  status: 'running' | 'done' | 'error';
  result?: ImportResult;
  error?: string;
  at: number;
}
const jobs = new Map<string, Job>();

export function startJob(userId: string, work: () => Promise<ImportResult>): string {
  const now = Date.now();
  for (const [id, j] of jobs) if (now - j.at > 30 * 60_000) jobs.delete(id);
  const id = randomUUID();
  const job: Job = { userId, status: 'running', at: now };
  jobs.set(id, job);
  work().then(
    (r) => Object.assign(job, { status: 'done', result: r }),
    (e) => {
      if (!(e instanceof HttpError)) console.error('[money import]', e);
      Object.assign(job, { status: 'error', error: e instanceof HttpError ? e.message : 'Не получилось прочитать выписку.' });
    },
  );
  return id;
}

export function readJob(userId: string, id: string | undefined): Omit<Job, 'userId' | 'at'> {
  const j = id ? jobs.get(id) : undefined;
  if (!j || j.userId !== userId) throw new HttpError(404, 'Задача не найдена — загрузите выписку ещё раз.');
  return { status: j.status, result: j.result, error: j.error };
}

// ---------------------------------------------------------------- чтение

function today(v: unknown): string {
  if (typeof v !== 'string' || !DAY_RE.test(v)) throw new HttpError(400, 'Неверная дата.');
  return v;
}

const aiAllowed = (d: Database.Database, userId: string) => aiConfigured() && !readMoneySettings(d, userId)?.hidden.includes('ai');

interface Template {
  signature: string;
  mapping: string | null;
  bank: string | null;
  account_id: string | null;
}

function templates(d: Database.Database, userId: string): Template[] {
  return d.prepare('select signature, mapping, bank, account_id from money_import_templates where user_id = ? order by updated_at desc').all(userId) as Template[];
}

const TABLE_DOC =
  'Ответ строго JSON — номера столбцов с нуля: {"header_row":номер строки заголовков,"date":столбец даты,' +
  '"amount":столбец суммы со знаком или null,"debit":столбец списаний или null,"credit":столбец поступлений или null,' +
  '"direction":столбец «тип/дебет-кредит», если суммы без знака, или null,"currency":столбец валюты или null,' +
  '"description":[столбцы описания: получатель, назначение — 1–3],"category":столбец категории банка или null,' +
  '"id":столбец номера операции или null,"status":столбец статуса или null,"orig_amount":сумма в валюте покупки или null,' +
  '"orig_currency":валюта покупки или null,"date_order":"dmy|mdy|ymd","invert":true если траты в amount положительные,"bank":"название банка, если понятно"}';

/** Таблица: свой шаблон → заголовки → ИИ (один раз, дальше шаблон). */
async function readTable(d: Database.Database, userId: string, rows: XCell[][], format: string): Promise<ParsedStatement & { signature: string; mapping: TableMapping }> {
  if (rows.length < 2) throw new HttpError(422, 'В таблице нет строк.');
  const saved = templates(d, userId).filter((t) => t.signature.startsWith('table:') && t.mapping);
  let mapping: TableMapping | null = null;
  let bank: string | undefined;
  for (const t of saved) {
    const m = JSON.parse(t.mapping!) as TableMapping;
    if (tableSignature(rows, m.header_row) === t.signature) {
      mapping = m;
      bank = t.bank ?? undefined;
      break;
    }
  }
  mapping ??= detectMapping(rows);
  if (!mapping) {
    if (!aiAllowed(d, userId)) throw new HttpError(422, 'Не узнал столбцы таблицы. Включите «Разбор фраз ИИ» в настройках — ИИ разберётся один раз и запомнит банк.');
    const sample = rows.slice(0, 14).map((r, i) => `${i}: ${JSON.stringify(r.map((c) => (typeof c === 'string' ? c.slice(0, 40) : c)))}`);
    const raw = await askJson(d, userId, {
      system: `Ты определяешь, какие столбцы банковской выписки что значат. Выписка может быть из любой страны. ${TABLE_DOC}`,
      user: sample.join('\n'),
      maxTokens: 800,
    });
    mapping = validMapping(raw, Math.max(...rows.slice(0, 30).map((r) => r.length)), rows.length);
    if (!mapping) throw new HttpError(422, 'Не понял, где в таблице дата и сумма. Попробуйте другой формат выписки (CSV или PDF).');
    bank = mapping.bank;
  }
  const txs = applyMapping(rows, mapping);
  if (!txs.length) throw new HttpError(422, 'В таблице не нашлось операций с датой и суммой.');
  return { format, bank: bank ?? mapping.bank, txs, signature: tableSignature(rows, mapping.header_row), mapping };
}

const TX_DOC =
  '"txs":[{"date":"ГГГГ-ММ-ДД","amount":число со знаком — минус для списаний, плюс для поступлений,"currency":"ISO-код" или null,' +
  '"description":"получатель и назначение как в выписке","category":"категория банка, если указана" или null}]';

async function readPdf(d: Database.Database, userId: string, buf: Buffer, name: string, day: string): Promise<ParsedStatement> {
  if (!aiAllowed(d, userId)) throw new HttpError(422, 'PDF читает ИИ — включите «Разбор фраз ИИ» в настройках или загрузите CSV/xlsx.');
  const raw = await askJson(d, userId, {
    system:
      `Ты переносишь операции из банковской выписки (PDF, любой банк и язык) в JSON. Сегодня ${day}. ` +
      'Выпиши все операции по порядку, ничего не пропуская и не придумывая. Остатки, итоги и заголовки — не операции. ' +
      `Ответ строго JSON: {"bank":"название банка","currency":"валюта счёта","account":"номер счёта или последние цифры карты",${TX_DOC}}`,
    user: [
      { type: 'text', text: 'Выписка:' },
      { type: 'file', file: { filename: name.replace(/[^\w.\-]/g, '_') || 'statement.pdf', file_data: `data:application/pdf;base64,${buf.toString('base64')}` } },
    ] as Part[],
    plugins: [{ id: 'file-parser', pdf: { engine: 'pdf-text' } }],
    maxTokens: 24000,
    timeoutMs: 170_000,
  });
  const r = parseAiTxs(raw, day);
  if (!r.txs.length) throw new HttpError(422, 'В PDF не нашлось операций. Если это скан, пришлите скриншоты или CSV.');
  return { format: 'PDF', ...r };
}

/** Файл выписки → строки. Формат узнаём по содержимому, а не по имени. */
async function readFile(d: Database.Database, userId: string, name: string, data: unknown, day: string): Promise<ParsedStatement & { signature?: string; mapping?: TableMapping }> {
  if (typeof data !== 'string') throw new HttpError(400, 'Нет файла.');
  const buf = Buffer.from(data, 'base64');
  if (!buf.length || buf.length > MAX_FILE) throw new HttpError(400, 'Файл пустой или больше 8 МБ.');
  if (buf.subarray(0, 4).toString('latin1') === '%PDF') return readPdf(d, userId, buf, name, day);
  if (buf[0] === 0xd0 && buf[1] === 0xcf) throw new HttpError(422, 'Старый формат Excel (.xls) не читается — сохраните как .xlsx или CSV.');
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    let rows: XCell[][];
    try {
      rows = readXlsx(buf);
    } catch {
      throw new HttpError(422, 'Не получилось открыть архив — это точно .xlsx?');
    }
    return readTable(d, userId, rows, 'Excel');
  }
  const text = decodeText(buf);
  const known = parseOfx(text) ?? parseCamt(text) ?? parseMt940(text) ?? parseQif(text);
  if (known) {
    if (!known.txs.length) throw new HttpError(422, `Файл ${known.format} прочитан, но операций в нём нет.`);
    return known;
  }
  return readTable(d, userId, parseCsv(text), 'CSV');
}

async function readScreens(d: Database.Database, userId: string, images: unknown, day: string): Promise<ParsedStatement & { merged: number }> {
  if (!Array.isArray(images) || !images.length || images.length > MAX_SCREENS) throw new HttpError(400, `Нужно от 1 до ${MAX_SCREENS} скриншотов.`);
  for (const img of images) {
    if (typeof img !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(img) || img.length > 3_000_000) throw new HttpError(400, 'Скриншот должен быть картинкой поменьше.');
  }
  if (!aiAllowed(d, userId)) throw new HttpError(422, 'Скриншоты читает ИИ — включите «Разбор фраз ИИ» в настройках.');
  const pages = await Promise.all(
    (images as string[]).map((img) =>
      askJson(d, userId, {
        system:
          `Это скриншот списка операций из приложения банка (любая страна и язык). Сегодня ${day}. ` +
          'Выпиши каждую видимую операцию. Даты бывают заголовками групп («Сегодня», «Вчера», «28 октября») — переводи в ГГГГ-ММ-ДД; ' +
          'без года — текущий год, а если дата тогда в будущем — прошлый. Траты в приложениях часто без минуса, а поступления с плюсом или зелёные — ставь знак сам. ' +
          'Подпись под названием («Супермаркеты», «Переводы») — категория банка. Обрезанные строки по краям экрана без суммы пропусти. ' +
          `Ответ строго JSON: {"bank":"какой банк по виду экрана или null","currency":"валюта счёта",${TX_DOC}}`,
        user: [{ type: 'image_url', image_url: { url: img } }],
        maxTokens: 4000,
      }).then((raw) => parseAiTxs(raw, day)),
    ),
  );
  const { txs, merged } = mergeScreens(pages.map((p) => p.txs));
  if (!txs.length) throw new HttpError(422, 'На скриншотах не нашлось операций. Нужен экран со списком операций и суммами.');
  return { format: 'Скриншоты', bank: pages.find((p) => p.bank)?.bank, currency: pages.find((p) => p.currency)?.currency ?? null, txs, merged };
}

// ---------------------------------------------------------------- подсказки

interface Hint {
  payee: string;
  category_id: string | null;
  own_transfer?: boolean;
}

/** Что человек уже импортировал: описание банка → его получатель и категория. */
function history(d: Database.Database, userId: string): Map<string, Hint> {
  const rows = d
    .prepare(
      `select o.note, o.payee, o.category_id, o.kind from money_ops o
       left join money_categories c on c.id = o.category_id
       where o.user_id = ? and o.source = 'import' and o.note is not null and (c.id is null or c.archived = 0)
       order by o.updated_at desc limit 3000`,
    )
    .all(userId) as { note: string; payee: string | null; category_id: string | null; kind: string }[];
  const map = new Map<string, Hint>();
  for (const r of rows) {
    const k = normDesc(r.note);
    if (k && !map.has(k)) map.set(k, { payee: r.payee ?? '', category_id: r.category_id, own_transfer: r.kind === 'transfer' });
  }
  return map;
}

async function aiHints(d: Database.Database, userId: string, list: { desc: string; bank_category?: string; sign: number }[]): Promise<Hint[]> {
  const cats = readCategories(d, userId);
  const accounts = readAccounts(d, userId).filter((a) => !a.archived);
  const out: Hint[] = [];
  for (let i = 0; i < list.length; i += 120) {
    const chunk = list.slice(i, i + 120);
    const raw = (await askJson(d, userId, {
      system:
        'Ты разбираешь строки банковской выписки. Для каждой: payee — короткое понятное название получателя или источника, как его называют люди ' +
        '(«YANDEX*GO MOSCOW» → «Яндекс Go», «Оплата в PYATEROCHKA 1234» → «Пятёрочка», «SPAR 0412 WIEN» → «Spar»); ' +
        `category — одна из категорий человека: расходы — ${cats.filter((c) => c.kind === 'expense').map((c) => c.name).join(', ')}; доходы — ${cats.filter((c) => c.kind === 'income').map((c) => c.name).join(', ')}; ` +
        `own_transfer — true, если это перевод между своими счетами (пополнение своего счёта, «перевод себе», «между своими счетами»). Свои счета: ${accounts.map((a) => a.name).join(', ')}. ` +
        'Ответ строго JSON: {"items":[{"i":номер,"payee":"…","category":"…","own_transfer":false}]}',
      user: chunk.map((x, j) => `${j}: ${x.sign < 0 ? 'списание' : 'поступление'} | ${x.desc}${x.bank_category ? ` | категория банка: ${x.bank_category}` : ''}`).join('\n'),
      maxTokens: 6000,
    })) as { items?: { i?: number; payee?: unknown; category?: unknown; own_transfer?: unknown }[] };
    const got = new Map((Array.isArray(raw?.items) ? raw.items : []).map((x) => [Number(x.i), x]));
    chunk.forEach((x, j) => {
      const h = got.get(j);
      const kind = x.sign < 0 ? 'expense' : 'income';
      const name = typeof h?.category === 'string' ? h.category.toLowerCase() : '';
      out.push({
        payee: typeof h?.payee === 'string' ? h.payee.trim().slice(0, 120) : '',
        category_id: cats.find((c) => c.kind === kind && c.name.toLowerCase() === name)?.id ?? null,
        own_transfer: h?.own_transfer === true,
      });
    });
  }
  return out;
}

/** Строки → подсказки: прошлые импорты, затем ИИ, затем категория банка. */
async function enrich(d: Database.Database, userId: string, txs: RawTx[]): Promise<ImportRow[]> {
  const cats = readCategories(d, userId);
  const accounts = readAccounts(d, userId).filter((a) => !a.archived);
  const past = history(d, userId);
  const keys = importKeys(txs);
  const hints: (Hint | undefined)[] = txs.map((t) => past.get(normDesc(t.description)));
  if (aiAllowed(d, userId)) {
    // ИИ — только для новых описаний, и каждое — один раз.
    const todo = new Map<string, { desc: string; bank_category?: string; sign: number }>();
    txs.forEach((t, i) => {
      const k = `${Math.sign(t.amount_minor)}|${normDesc(t.description)}`;
      if (!hints[i] && t.description && !todo.has(k)) todo.set(k, { desc: t.description.slice(0, 160), bank_category: t.bank_category, sign: Math.sign(t.amount_minor) });
    });
    if (todo.size) {
      try {
        const got = await aiHints(d, userId, [...todo.values()]);
        const byKey = new Map([...todo.keys()].map((k, i) => [k, got[i]]));
        txs.forEach((t, i) => {
          hints[i] ??= byKey.get(`${Math.sign(t.amount_minor)}|${normDesc(t.description)}`);
        });
      } catch (e) {
        // Без подсказок ИИ импорт всё равно работает — категории человек выберет сам.
        console.error('[money import] подсказки ИИ:', (e as Error).message);
      }
    }
  }
  return txs.map((t, i) => {
    const h = hints[i];
    const kind = t.amount_minor < 0 ? 'expense' : 'income';
    const bankCat = t.bank_category?.toLowerCase();
    const category_id = h?.category_id ?? (bankCat ? (cats.find((c) => c.kind === kind && c.name.toLowerCase() === bankCat)?.id ?? null) : null);
    // Свой счёт по имени в описании («Перевод на Wise») — перевод.
    const low = t.description.toLowerCase();
    // Перевод — только на счёт в той же валюте; в другой — это обмен, его человек запишет сам.
    const named = accounts.find((a) => a.name.length >= 3 && low.includes(a.name.toLowerCase()) && (!t.currency || a.currency === t.currency));
    const mentioned = accounts.some((a) => a.name.length >= 3 && low.includes(a.name.toLowerCase()));
    const transfer = !!h?.own_transfer || (mentioned && /перевод|transfer|пополнен|top.?up/i.test(t.description));
    return {
      ...t,
      key: keys[i],
      kind: transfer && named ? 'transfer' : kind,
      payee: h?.payee || '',
      category_id: transfer && named ? null : category_id,
      to_account_id: transfer && named ? named.id : null,
      transfer_hint: transfer && !named,
    };
  });
}

/** Какой счёт предложить: тот же, что в прошлый раз для этой выписки, иначе в её валюте. */
function suggestAccount(d: Database.Database, userId: string, signature: string | null, accountRef: string | null, cur: string | null): string | null {
  const t = templates(d, userId);
  const accounts = readAccounts(d, userId).filter((a) => !a.archived && a.mine);
  const known = t.find((x) => x.account_id && (x.signature === signature || (accountRef && x.signature === `acct:${accountRef}`)));
  if (known && accounts.some((a) => a.id === known.account_id)) return known.account_id;
  const inCur = cur ? accounts.filter((a) => a.currency === cur) : [];
  return inCur.length === 1 ? inCur[0].id : null;
}

/** Загрузка: файл или скриншоты → задача. */
export function startImport(d: Database.Database, userId: string, body: Record<string, unknown>): { job: string } {
  if (!readMoneySettings(d, userId)) throw new HttpError(409, 'Сначала выберите валюты.');
  const day = today(body.today);
  const name = typeof body.name === 'string' ? body.name.slice(0, 120) : 'statement';
  // Проверки размера — сразу, чтобы не ждать задачу ради понятной ошибки.
  if (body.kind === 'screens') {
    if (!Array.isArray(body.images) || !body.images.length || body.images.length > MAX_SCREENS) throw new HttpError(400, `Нужно от 1 до ${MAX_SCREENS} скриншотов.`);
  } else if (typeof body.data !== 'string' || body.data.length > (MAX_FILE * 4) / 3 + 16) throw new HttpError(400, 'Файл пустой или больше 8 МБ.');
  return {
    job: startJob(userId, async () => {
      const p = body.kind === 'screens' ? await readScreens(d, userId, body.images, day) : await readFile(d, userId, name, body.data, day);
      const signature = 'signature' in p && p.signature ? p.signature : p.account_ref ? `acct:${p.account_ref}` : null;
      const tpl = signature ? templates(d, userId).find((t) => t.signature === signature) : undefined;
      return {
        format: p.format,
        bank: p.bank ?? tpl?.bank ?? null,
        currency: p.currency ?? null,
        account_ref: p.account_ref ?? null,
        signature,
        mapping: 'mapping' in p ? (p.mapping ?? null) : null,
        merged: 'merged' in p ? p.merged : 0,
        account_id: suggestAccount(d, userId, signature, p.account_ref ?? null, p.currency ?? null),
        rows: await enrich(d, userId, p.txs.slice(0, 2000)),
      };
    }),
  };
}

// ---------------------------------------------------------------- повторы

export type CheckStatus = { status: 'new' } | { status: 'exists' } | { status: 'link'; op_id: string; title: string; day: string; source: string };

/**
 * Что из выписки уже есть на счёте: тот же ключ — «уже было» (повторный
 * импорт); операция на ту же сумму в пределах 3 дней без ключа — записана
 * вручную (или чеком), её склеим с банковской строкой.
 */
export function checkRows(d: Database.Database, userId: string, accountId: string, rows: { key: string; day: string; amount_minor: number }[]): CheckStatus[] {
  const acc = readAccounts(d, userId).find((a) => a.id === accountId);
  if (!acc) throw new HttpError(400, 'Нет такого счёта.');
  const keys = new Set(
    (d.prepare('select import_key from money_ops where account_id = ? and import_key is not null').all(accountId) as { import_key: string }[]).map((r) => r.import_key),
  );
  const days = rows.map((r) => r.day).sort();
  const shift = (day: string, n: number) => new Date(Date.parse(`${day}T12:00:00Z`) + n * 864e5).toISOString().slice(0, 10);
  const cands = days.length
    ? (d
        .prepare(
          `select o.id, o.kind, o.day, o.account_id, o.amount_minor, o.to_account_id, o.to_amount_minor, o.payee, o.source, c.name as category_name
           from money_ops o left join money_categories c on c.id = o.category_id
           where (o.account_id = ? or o.to_account_id = ?) and o.day between ? and ?
             -- Перевод мог прийти из выписки второго счёта — у него уже свой ключ.
             and (o.import_key is null or o.kind = 'transfer')`,
        )
        .all(accountId, accountId, shift(days[0], -3), shift(days[days.length - 1], 3)) as {
        id: string;
        kind: 'expense' | 'income' | 'transfer' | 'exchange';
        day: string;
        account_id: string;
        amount_minor: number;
        to_account_id: string | null;
        to_amount_minor: number | null;
        payee: string | null;
        source: string;
        category_name: string | null;
      }[])
    : [];
  const used = new Set<string>();
  return rows.map((r) => {
    if (keys.has(r.key)) return { status: 'exists' };
    const t = Date.parse(`${r.day}T12:00:00Z`);
    let best: (typeof cands)[number] | null = null;
    let bestGap = Infinity;
    for (const c of cands) {
      if (used.has(c.id) || opEffect(c, accountId) !== r.amount_minor) continue;
      const gap = Math.abs(Date.parse(`${c.day}T12:00:00Z`) - t) / 864e5;
      if (gap <= 3 && gap < bestGap) {
        best = c;
        bestGap = gap;
      }
    }
    if (!best) return { status: 'new' };
    used.add(best.id);
    return { status: 'link', op_id: best.id, title: best.payee || best.category_name || 'операция', day: best.day, source: best.source };
  });
}

/** Запомнить, как читать эту выписку и на какой счёт её класть. */
export function saveTemplate(d: Database.Database, userId: string, signature: string | null, mapping: unknown, bank: unknown, accountId: string) {
  if (!signature || typeof signature !== 'string' || signature.length > 500) return;
  const m = mapping && typeof mapping === 'object' ? JSON.stringify(mapping).slice(0, 4000) : null;
  d.prepare(
    `insert into money_import_templates (user_id, signature, mapping, bank, account_id) values (?, ?, ?, ?, ?)
     on conflict (user_id, signature) do update set mapping = coalesce(excluded.mapping, mapping), bank = coalesce(excluded.bank, bank),
       account_id = excluded.account_id, updated_at = datetime('now')`,
  ).run(userId, signature, m, typeof bank === 'string' ? bank.slice(0, 60) : null, accountId);
}
