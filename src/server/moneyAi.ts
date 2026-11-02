import type Database from 'better-sqlite3';
import { normItem } from '@/lib/money';
import { parseDrafts, parseReceipt, type AiContext, type MoneyDraft, type ReceiptDraft } from '@/lib/moneyAi';
import { askJson, audioModel, receiptModel, type Part } from './ai';
import { DAY_RE, HttpError, text } from './http';
import { readAccounts, readCategories, readMoneySettings } from './moneyStore';

/**
 * ИИ в «Деньгах»: фраза, голос и фото чека → черновики. Сохраняет человек
 * сам обычным POST /money/ops — после того как посмотрел.
 */

const MAX_IMAGE = 3_000_000;
const MAX_AUDIO = 3_000_000;
const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

export function moneyContext(d: Database.Database, userId: string, today: unknown): AiContext {
  if (typeof today !== 'string' || !DAY_RE.test(today)) throw new HttpError(400, 'Неверная дата.');
  const s = readMoneySettings(d, userId);
  if (!s) throw new HttpError(409, 'Сначала выберите валюты.');
  return {
    accounts: readAccounts(d, userId).filter((a) => !a.archived),
    categories: readCategories(d, userId),
    today,
    base: s.base_currency,
  };
}

/** Где человек обычно что покупает: «Пятёрочка → Продукты» — подсказка модели. */
export function habits(d: Database.Database, userId: string): string[] {
  const rows = d
    .prepare(
      `select o.payee, c.name from money_ops o join money_categories c on c.id = o.category_id
       where o.user_id = ? and o.payee is not null group by lower(o.payee) order by max(o.created_at) desc limit 40`,
    )
    .all(userId) as { payee: string; name: string }[];
  return rows.map((r) => `${r.payee} → ${r.name}`);
}

function opsPrompt(ctx: AiContext, d: Database.Database, userId: string): string {
  const wd = WEEKDAYS[new Date(`${ctx.today}T12:00:00`).getDay()];
  const known = habits(d, userId);
  return (
    `Ты разбираешь, что человек записал о своих деньгах, на операции. Сегодня ${ctx.today}, ${wd}. ` +
    `Основная валюта — ${ctx.base}. ` +
    `Счета: ${ctx.accounts.map((a) => `«${a.name}» (${a.currency})`).join(', ')}. ` +
    `Категории расходов: ${ctx.categories.filter((c) => c.kind === 'expense').map((c) => c.name).join(', ')}. ` +
    `Категории доходов: ${ctx.categories.filter((c) => c.kind === 'income').map((c) => c.name).join(', ')}. ` +
    (known.length ? `Раньше человек записывал так: ${known.join('; ')}. ` : '') +
    'Операция: {"kind":"expense|income|transfer|exchange","amount":число в валюте,"currency":"код ISO или null, если не назвали",' +
    '"account":"название счёта из списка или null","category":"категория из списка или null","payee":"где или на что, коротко, с большой буквы",' +
    '"date":"ГГГГ-ММ-ДД","note":"…" или null,"to_account":"для перевода и обмена — куда","to_amount":число (для обмена — сколько получил),"to_currency":"код"}. ' +
    'Правила: «вчера», «в пятницу» переводи в даты, не сказано — сегодня. Суммы словами («тысяча двести») — числом. ' +
    '«евро», «долларов», «лари», «тенге» — валюта. Несколько трат в одной фразе — несколько операций. ' +
    'payee без суммы и даты: «кофе 350» → payee «Кофе». Категорию бери только из списка. ' +
    'Ответ строго JSON: {"ops":[…]}'
  );
}

/** Фраза → черновики операций. */
export async function aiText(d: Database.Database, userId: string, body: Record<string, unknown>): Promise<{ ops: MoneyDraft[] }> {
  const ctx = moneyContext(d, userId, body.today);
  const phrase = text(body.text, 1000, 'Фраза') as string;
  const raw = await askJson(d, userId, { system: opsPrompt(ctx, d, userId), user: phrase, maxTokens: 1500 });
  const ops = parseDrafts(raw, ctx, phrase);
  if (!ops.length) throw new HttpError(422, 'Не нашёл суммы. Скажите, например: «кофе 350» или «такси 12 евро вчера».');
  return { ops };
}

const AUDIO_FORMATS: Record<string, string> = { mp4: 'm4a', 'x-m4a': 'm4a', m4a: 'm4a', aac: 'aac', mpeg: 'mp3', mp3: 'mp3', wav: 'wav', 'x-wav': 'wav', ogg: 'ogg', webm: 'webm' };

/** Запись голоса → что сказал и черновики операций, одним запросом к модели со звуком. */
export async function aiVoice(d: Database.Database, userId: string, body: Record<string, unknown>): Promise<{ said: string; ops: MoneyDraft[] }> {
  const ctx = moneyContext(d, userId, body.today);
  const m = typeof body.audio === 'string' ? /^data:audio\/([\w.+-]+)(?:;[^,]*)?;base64,(.+)$/.exec(body.audio) : null;
  const format = m ? AUDIO_FORMATS[m[1].toLowerCase()] : undefined;
  if (!m || !format || (body.audio as string).length > MAX_AUDIO) throw new HttpError(400, 'Запись не подошла — попробуйте сказать короче.');
  const raw = (await askJson(d, userId, {
    model: audioModel(),
    system: `${opsPrompt(ctx, d, userId)} Сначала дословно запиши, что сказал человек, в поле "said": {"said":"…","ops":[…]}.`,
    user: [
      { type: 'text', text: 'Запись голоса:' },
      { type: 'input_audio', input_audio: { data: m[2], format } },
    ] as Part[],
    maxTokens: 1500,
  })) as { said?: unknown };
  const said = typeof raw?.said === 'string' ? raw.said.trim().slice(0, 1000) : '';
  const ops = parseDrafts(raw, ctx, said || undefined).map((o) => ({ ...o, source: 'voice' }));
  if (!ops.length) throw new HttpError(422, said ? `Не нашёл суммы в «${said.slice(0, 80)}». Скажите, например: «кофе триста пятьдесят».` : 'Ничего не расслышал. Попробуйте ещё раз, поближе к телефону.');
  return { said, ops };
}

/** Последняя категория, которую человек ставил товару с таким названием. */
export function itemHistory(d: Database.Database, userId: string): (name: string) => string | null {
  const q = d.prepare(
    `select i.category_id from money_items i join money_ops o on o.id = i.op_id
     join money_categories c on c.id = i.category_id and c.user_id = ? and c.archived = 0
     where o.user_id = ? and i.norm_name = ? order by o.day desc, o.created_at desc limit 1`,
  );
  return (name) => {
    const n = normItem(name);
    return n ? ((q.get(userId, userId, n) as { category_id: string } | undefined)?.category_id ?? null) : null;
  };
}

/** Фото чека → магазин, дата, итог и позиции с категориями. */
export async function aiReceipt(d: Database.Database, userId: string, body: Record<string, unknown>): Promise<{ receipt: ReceiptDraft }> {
  const ctx = moneyContext(d, userId, body.today);
  const img = body.image;
  if (typeof img !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(img) || img.length > MAX_IMAGE) {
    throw new HttpError(400, 'Нужна фотография чека (JPEG, PNG или WebP) поменьше.');
  }
  const raw = await askJson(d, userId, {
    // Названия позиций на чеках — сокращения кассы («ПЕР.SEL.Макароны по-флотс.180г»).
    // Основная модель их «расшифровывала» и придумывала товары; Gemini читает буква в букву.
    model: receiptModel(),
    system:
      `Ты переписываешь кассовый чек с фото — любой страны и языка. Сегодня ${ctx.today}. Основная валюта человека — ${ctx.base}. ` +
      `Категории расходов: ${ctx.categories.filter((c) => c.kind === 'expense').map((c) => c.name).join(', ')}. ` +
      'Для каждой строки товара: {"name":"название, как напечатано","qty":количество или вес,"unit":"шт|кг|г|л|мл" или null,' +
      '"price":цена за единицу после скидки или null,"total":сумма строки (обычно последний столбец),"category":"категория из списка"}. ' +
      'Название: переписывай как в чеке, только убери код или артикул в начале строки (цифры перед названием). ' +
      'Слово, обрезанное точкой, допиши, только если оно однозначно («по-флотс.» → «по-флотски», «сосис.» → «сосиски»); ' +
      'бренды и сокращения марок не трогай; не угадывай — непонятное оставь как есть. ' +
      'Если в чеке есть столбцы «цена до скидки», «скидка», «цена», бери сумму строки из последнего столбца — она уже со скидкой; ' +
      '«скидка на чек» в конце — это обычно сумма этих скидок, второй раз её не вычитай. Сумма строк должна сойтись с итогом. ' +
      'Дата на российских чеках — ДД.ММ.ГГ (24.09.26 — это 2026-09-24). ' +
      'Ответ строго JSON: {"payee":"магазин коротко, как его называют люди (Перекрёсток, Пятёрочка, Lidl)","date":"ГГГГ-ММ-ДД","time":"ЧЧ:ММ" или null,' +
      '"currency":"код ISO по чеку","total":итог к оплате,"items":[…]}. Не видно чека — {"items":[]}.',
    user: [{ type: 'text', text: 'Фото чека:' }, { type: 'image_url', image_url: { url: img } }],
    maxTokens: 6000,
  });
  const receipt = parseReceipt(raw, ctx, itemHistory(d, userId));
  if (!receipt) throw new HttpError(422, 'Не разобрал чек. Сфотографируйте ровно, при хорошем свете, чтобы был виден итог.');
  return { receipt };
}
