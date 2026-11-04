import type Database from 'better-sqlite3';
import { normItem } from '@/lib/money';
import { parseDrafts, parseReceipt, type AiContext, type MoneyDraft, type ReceiptDraft } from '@/lib/moneyAi';
import { askJson, audioModel, receiptModel, type Part } from './ai';
import { DAY_RE, HttpError, text } from './http';
import { readAccounts, readCategories, readMoneySettings } from './moneyStore';
import { ASK_RULES, askContext } from './moneyReport';

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

export type SayResult = { result: 'payment'; ops: MoneyDraft[] } | { result: 'question'; answer: string; search: string | null };

/**
 * Строка ввода «Денег»: одной просьбой к модели — и понять, запись это или
 * вопрос о своих деньгах, и сразу сделать нужное. Запись — черновики (человек
 * сохраняет сам), вопрос — ответ по его данным.
 */
/** Подсказка «запись или вопрос»: правила записи, правила ответа и данные для ответа. */
function sayPrompt(ctx: AiContext, d: Database.Database, userId: string, how: 'пишет в одну строку' | 'говорит голосом'): string {
  return (
    `Ты помощник в приложении учёта личных финансов. Человек ${how}: либо записывает операцию ` +
    '(трату, доход, перевод: «кофе 350», «такси 12 евро вчера», «зарплата 80000»), либо спрашивает о своих деньгах ' +
    '(«сколько ушло на кофе?», «что я покупал вчера», «где я трачу больше всего»). Сначала реши, что это. ' +
    'Есть сумма и это не вопрос — запись. Вопрос о прошлых тратах, даже с числами («за 3 месяца»), — вопрос. ' +
    'Если в строке и запись, и вопрос — это запись.\n\n' +
    `ЗАПИСЬ. ${opsPrompt(ctx, d, userId).replace('Ответ строго JSON: {"ops":[…]}', '')}` +
    'Ответ строго JSON: {"result":"payment","ops":[…]}\n\n' +
    `ВОПРОС. ${ASK_RULES}` +
    'Если ответ про конкретные траты, которые можно найти в списке операций (место, товар, категория), добавь "search" — ' +
    'одно-два слова для поиска по операциям («такси», «Пятёрочка», «кофе»), иначе null. ' +
    'Ответ строго JSON: {"result":"question","answer":"…","search":"…"|null}\n\n' +
    `Данные для ответа на вопрос:\n${askContext(d, userId, ctx.today)}`
  );
}

/** Прошлые вопросы и ответы — чтобы понять «а за прошлый месяц?». */
function history(raw: unknown): string {
  if (!Array.isArray(raw)) return '';
  const lines = raw
    .slice(-3)
    .filter((h): h is { q: string; a: string } => !!h && typeof (h as { q?: unknown }).q === 'string' && typeof (h as { a?: unknown }).a === 'string')
    .map((h) => `Вопрос: ${h.q.slice(0, 300)}\nОтвет: ${h.a.slice(0, 800)}`);
  return lines.length ? `Перед этим человек спрашивал:\n${lines.join('\n')}\n\nТеперь: ` : '';
}

/** Ответ модели → запись или ответ. Модель могла не назвать result — смотрим, что она прислала. */
function sayResult(raw: { result?: unknown; answer?: unknown; ops?: unknown; search?: unknown }, ctx: AiContext, phrase: string | undefined): SayResult | null {
  const answer = typeof raw?.answer === 'string' ? raw.answer.trim().slice(0, 2000) : '';
  const isQuestion = raw?.result === 'question' || (raw?.result !== 'payment' && !!answer && !Array.isArray(raw?.ops));
  if (isQuestion) {
    if (!answer) throw new HttpError(502, 'Не получилось ответить. Спросите иначе.');
    const search = typeof raw.search === 'string' && raw.search.trim() ? raw.search.trim().slice(0, 40) : null;
    return { result: 'question', answer, search };
  }
  const ops = parseDrafts(raw, ctx, phrase);
  return ops.length ? { result: 'payment', ops } : null;
}

export async function aiSay(d: Database.Database, userId: string, body: Record<string, unknown>): Promise<SayResult> {
  const ctx = moneyContext(d, userId, body.today);
  const phrase = text(body.text, 1000, 'Фраза') as string;
  const raw = (await askJson(d, userId, {
    system: sayPrompt(ctx, d, userId, 'пишет в одну строку'),
    user: history(body.history) + phrase,
    maxTokens: 1500,
  })) as { result?: unknown; answer?: unknown; ops?: unknown; search?: unknown };
  const r = sayResult(raw, ctx, phrase);
  if (!r) throw new HttpError(422, 'Не нашёл суммы. Напишите, например: «кофе 350» — или задайте вопрос: «сколько ушло на кофе?»');
  return r;
}

const AUDIO_FORMATS: Record<string, string> = { mp4: 'm4a', 'x-m4a': 'm4a', m4a: 'm4a', aac: 'aac', mpeg: 'mp3', mp3: 'mp3', wav: 'wav', 'x-wav': 'wav', ogg: 'ogg', webm: 'webm' };

/**
 * Запись голоса → что сказал и черновики операций, одним запросом к модели со
 * звуком. С ask: true модель ещё и решает, вопрос ли это, — тогда ответ.
 */
export async function aiVoice(d: Database.Database, userId: string, body: Record<string, unknown>): Promise<{ said: string } & ({ ops: MoneyDraft[] } | SayResult)> {
  const ctx = moneyContext(d, userId, body.today);
  const m = typeof body.audio === 'string' ? /^data:audio\/([\w.+-]+)(?:;[^,]*)?;base64,(.+)$/.exec(body.audio) : null;
  const format = m ? AUDIO_FORMATS[m[1].toLowerCase()] : undefined;
  if (!m || !format || (body.audio as string).length > MAX_AUDIO) throw new HttpError(400, 'Запись не подошла — попробуйте сказать короче.');
  if (body.ask) {
    const raw = (await askJson(d, userId, {
      model: audioModel(),
      system: `${sayPrompt(ctx, d, userId, 'говорит голосом')}\n\nСначала дословно запиши, что сказал человек, в поле "said" того же JSON.`,
      user: [
        { type: 'text', text: 'Запись голоса:' },
        { type: 'input_audio', input_audio: { data: m[2], format } },
      ] as Part[],
      maxTokens: 1500,
    })) as { said?: unknown; result?: unknown; answer?: unknown; ops?: unknown; search?: unknown };
    const said = typeof raw?.said === 'string' ? raw.said.trim().slice(0, 1000) : '';
    const r = sayResult(raw, ctx, said || undefined);
    if (!r) throw new HttpError(422, said ? `Не понял «${said.slice(0, 80)}». Скажите, например: «кофе триста пятьдесят» или «сколько ушло на кафе?».` : 'Ничего не расслышал. Попробуйте ещё раз, поближе к телефону.');
    return r.result === 'payment' ? { said, ...r, ops: r.ops.map((o) => ({ ...o, source: 'voice' })) } : { said, ...r };
  }
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
