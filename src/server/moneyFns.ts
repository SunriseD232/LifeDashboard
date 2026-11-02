import type Database from 'better-sqlite3';
import { parseFiscalQr, parseFnsReceipt, type ReceiptDraft } from '@/lib/moneyAi';
import { aiConfigured, askJson } from './ai';
import { HttpError } from './http';
import { itemHistory, moneyContext } from './moneyAi';

/**
 * Позиции чека по QR: сам QR несёт только сумму и время, а товары лежат в
 * ФНС. Своего входа в ФНС у нас нет — спрашиваем proverkacheka.com (ключ
 * PROVERKACHEKA_TOKEN в .env, получают на сайте после регистрации).
 * Категории — как человек ставил раньше, остальное раскладывает ИИ.
 */

const URL = 'https://proverkacheka.com/api/v1/check/get';

type Transport = (body: URLSearchParams) => Promise<unknown>;
let transport: Transport = async (body) => {
  const r = await fetch(URL, { method: 'POST', body, signal: AbortSignal.timeout(20000), cache: 'no-store' });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};

/** Для тестов: подменить сеть. */
export function setFnsTransport(t: Transport) {
  transport = t;
}

export const fnsConfigured = () => !!process.env.PROVERKACHEKA_TOKEN?.trim();

// Ответы сервиса, кроме 1 (чек найден).
const CODES: Record<number, string> = {
  0: 'ФНС не знает такого чека — проверьте, что это QR кассового чека.',
  2: 'Чек ещё не дошёл до ФНС — обычно это до суток. Попробуйте позже.',
  3: 'Проверка чеков по QR на сегодня исчерпана. Завтра заработает снова, а пока — фото чека.',
  4: 'Сервис проверки чеков просит подождать. Попробуйте через минуту.',
  5: 'ФНС не ответила про этот чек. Попробуйте позже или сфотографируйте чек целиком.',
};

export async function receiptByQr(d: Database.Database, userId: string, body: Record<string, unknown>): Promise<{ receipt: ReceiptDraft }> {
  const ctx = moneyContext(d, userId, body.today);
  const qr = typeof body.qr === 'string' ? body.qr.trim().slice(0, 500) : '';
  if (!parseFiscalQr(qr)) throw new HttpError(400, 'Это не QR кассового чека.');
  if (!fnsConfigured()) throw new HttpError(503, 'Позиции по QR пока не подключены — прочитаю чек с фото.');
  let raw: unknown;
  try {
    raw = await transport(new URLSearchParams({ token: process.env.PROVERKACHEKA_TOKEN!.trim(), qrraw: qr }));
  } catch {
    throw new HttpError(502, 'Сервис проверки чеков не ответил. Попробуйте позже.');
  }
  const receipt = parseFnsReceipt(raw, ctx, itemHistory(d, userId));
  if (!receipt) {
    const code = Number((raw as { code?: unknown })?.code);
    throw new HttpError(422, CODES[code] ?? CODES[5]);
  }
  if (receipt.items.some((i) => !i.category_id) && aiConfigured()) await categorize(d, userId, receipt, ctx.categories);
  return { receipt };
}

/** Категории позиций и понятное название магазина — одним коротким запросом. Не вышло — без них. */
async function categorize(d: Database.Database, userId: string, r: ReceiptDraft, categories: { id: string; kind: string; name: string }[]) {
  const cats = categories.filter((c) => c.kind === 'expense');
  try {
    const raw = (await askJson(d, userId, {
      system:
        `Разложи позиции кассового чека по категориям расходов: ${cats.map((c) => c.name).join(', ')}. ` +
        'Магазин назови коротко, как его называют люди (ООО «Агроторг» → Пятёрочка, «Торговый дом Перекрёсток» → Перекрёсток); не знаешь — как есть. ' +
        'Ответ строго JSON: {"payee":"…","categories":["категория для позиции 1", "…для позиции 2", …]} — столько же, сколько позиций, по порядку.',
      user: `Магазин: ${r.payee || 'не указан'}\nПозиции:\n${r.items.map((i, k) => `${k + 1}. ${i.name}`).join('\n')}`,
      maxTokens: 3000,
    })) as { payee?: unknown; categories?: unknown };
    const list = Array.isArray(raw?.categories) ? raw.categories : [];
    r.items.forEach((it, k) => {
      if (it.category_id) return;
      const n = typeof list[k] === 'string' ? list[k].trim().toLowerCase() : '';
      it.category_id = cats.find((c) => c.name.toLowerCase() === n)?.id ?? null;
    });
    if (typeof raw?.payee === 'string' && raw.payee.trim()) r.payee = raw.payee.trim().slice(0, 120);
  } catch {
    /* без категорий — человек поставит сам */
  }
}
