import { userLogin } from '@/lib/auth';
import { parseQuickAdd, type QuickItem } from '@/lib/aiParse';
import { convert } from '@/lib/money';
import { parseDrafts, type AiContext, type MoneyDraft } from '@/lib/moneyAi';
import { weekday } from '@/lib/recur';
import { aiConfigured, askJson, audioModel, type Part } from '../ai';
import { DAY_RE, HttpError, text, type Ctx } from '../http';
import { habits, moneyContext } from '../moneyAi';
import { moneyAllowed, readAccounts, readMoneySettings, readUserRates } from '../moneyStore';
import { todayRates } from '../moneyRates';
import { readSettings } from '../settings';
import { readTags } from '../tagStore';
import { RULE_DOC } from './ai';
import { checklists } from './checklists';
import { kitchen } from './kitchen';
import { money } from './money';
import { notes } from './notes';
import { reminders } from './reminders';
import { tasks } from './tasks';

/**
 * Главная супер-аппа: одна строка на всё. Фраза или запись голоса → дела,
 * напоминания, заметки, покупки и траты одним запросом к ИИ; длинный текст —
 * дело с коротким названием, полным текстом в описании и подзадачами.
 * Сохранение — тоже здесь, разом: подзадачи становятся чек-листом дела, трата
 * в чужой валюте пересчитывается по курсу ЦБ.
 *
 *  POST hub/parse { text, today } · hub/voice { audio, today } → { said?, items };
 *  POST hub/save { items, money_account? } → { saved }.
 */

/** Дело или напоминание — с описанием и подзадачами (их нет в обычном быстром вводе). */
type Extra = { note: string | null; subtasks: string[] };
export type HubItem = (Extract<QuickItem, { type: 'task' | 'reminder' }> & Extra) | Extract<QuickItem, { type: 'note' | 'shopping' }> | { type: 'money'; draft: MoneyDraft };

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

function day(v: unknown): string {
  if (typeof v !== 'string' || !DAY_RE.test(v)) throw new HttpError(400, 'Неверная дата.');
  return v;
}

/** Деньги доступны: раздел открыт и первый запуск пройден. */
function moneyOn(d: Ctx['d'], userId: string): boolean {
  return moneyAllowed(userId, userLogin(userId)) && !!readMoneySettings(d, userId);
}

function prompt(d: Ctx['d'], userId: string, today: string, mctx: AiContext | null): string {
  const own = readTags(d, userId);
  const at = readSettings(d, userId).deadline_time;
  const known = mctx ? habits(d, userId) : [];
  return (
    `Ты разбираешь то, что человек записал или надиктовал, на записи двух приложений: «Дела» и «Деньги». Сегодня ${today}, ${WEEKDAYS[weekday(today)]}.\n` +
    'Типы записей:\n' +
    '- task: дело: {"type":"task","title":"…","due_date":"ГГГГ-ММ-ДД" — если есть срок («до 15 ноября», «к пятнице»), иначе null,"note":"…" или null,"subtasks":["…"],"tags":[метки],"priority":0-3}\n' +
    `- reminder: есть день, время или повтор: {"type":"reminder","title":"…","times":["ЧЧ:ММ"],"rule":RULE,"note":"…" или null,"subtasks":["…"],"tags":[],"priority":0-3}; день без времени — ${at}\n` +
    '- note: просто информация на запомнить: {"type":"note","title":"…","body":"…"}\n' +
    '- shopping: что купить: {"type":"shopping","name":"продукт в именительном падеже","qty":число или null,"unit":"г|кг|мл|л|шт.|упак." или null}\n' +
    (mctx
      ? '- money: деньги уже потрачены или получены (есть сумма): {"type":"money","kind":"expense|income","amount":число,"currency":"код ISO или null",' +
        '"account":"счёт из списка или null","category":"категория из списка или null","payee":"где или на что, коротко","date":"ГГГГ-ММ-ДД"}\n' +
        `Счета: ${mctx.accounts.map((a) => `«${a.name}» (${a.currency})`).join(', ')}. Основная валюта — ${mctx.base}. ` +
        `Категории расходов: ${mctx.categories.filter((c) => c.kind === 'expense').map((c) => c.name).join(', ')}; доходов: ${mctx.categories.filter((c) => c.kind === 'income').map((c) => c.name).join(', ')}. ` +
        (known.length ? `Раньше человек записывал так: ${known.slice(0, 20).join('; ')}. ` : '') +
        '\n'
      : '') +
    `${RULE_DOC}\n` +
    'Правила: «завтра», «в пятницу» переводи в даты; «вечером» — 19:00, «утром» — 09:00. Одна фраза может дать несколько записей разных типов. ' +
    (mctx ? '«Потратил», «заплатил», «кофе 350» — money, а «купить молоко», «оплатить интернет завтра» — shopping или reminder (это ещё не трата). ' : '') +
    'ДЛИННЫЙ ТЕКСТ про одно дело: короткое название (до 60 символов, как в списке дел), весь текст человека — в note без сокращений, ' +
    'перечисленные шаги — в subtasks (коротко, каждый — действие). Короткому делу note — null, subtasks — []. ' +
    `Метки: ${own.length ? `свои: ${own.join(', ')} — только из них` : 'своих нет'}; новую — только если человек сам назвал. ` +
    'priority: 3 — «срочно», 2 — «важно», 1 — «не к спеху», иначе 0. ' +
    'Ответ строго JSON: {"items":[…]}'
  );
}

const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);

/** Ответ модели → записи: дела и прочее — проверкой быстрого ввода, деньги — проверкой «Денег». */
export function parseHub(raw: unknown, defaultTime: string, mctx: AiContext | null, said?: string): HubItem[] {
  const out: HubItem[] = [];
  const list = Array.isArray((raw as { items?: unknown })?.items) ? ((raw as { items: unknown[] }).items as Record<string, unknown>[]) : [];
  for (const it of list.slice(0, 20)) {
    if (!it || typeof it !== 'object') continue;
    if (it.type === 'money') {
      if (!mctx) continue;
      const [draft] = parseDrafts({ ops: [it] }, mctx, said);
      if (draft) out.push({ type: 'money', draft });
      continue;
    }
    const [q] = parseQuickAdd({ items: [it] }, defaultTime);
    if (!q) continue;
    if (q.type === 'task' || q.type === 'reminder') {
      const subtasks = Array.isArray(it.subtasks) ? it.subtasks.map((s) => str(s, 120)).filter((s): s is string => !!s).slice(0, 20) : [];
      let note = str(it.note, 2000);
      // Длинный текст — в описание целиком: модель любит его сокращать. Только первому
      // делу, у которого есть подзадачи или описание, — остальное из фразы короткое.
      const long = said && said.length >= LONG_TEXT && !out.some((x) => (x.type === 'task' || x.type === 'reminder') && x.note === said.slice(0, 2000));
      if (long && (subtasks.length || note) && (!note || note.length < said.length * 0.6)) note = said.slice(0, 2000);
      out.push({ ...q, note, subtasks });
    } else out.push(q);
  }
  return out;
}

/** С какой длины текст считаем «длинным»: тогда он целиком идёт в описание дела. */
const LONG_TEXT = 120;

const AUDIO: Record<string, string> = { mp4: 'm4a', 'x-m4a': 'm4a', m4a: 'm4a', aac: 'aac', mpeg: 'mp3', mp3: 'mp3', wav: 'wav', 'x-wav': 'wav', ogg: 'ogg', webm: 'webm' };

export async function hub(ctx: Ctx): Promise<unknown> {
  const { d, userId, method, body, id } = ctx;
  if (method !== 'POST') return undefined;

  if (id === 'parse' || id === 'voice') {
    if (!aiConfigured()) throw new HttpError(503, 'ИИ пока не подключён.');
    const today = day(body.today);
    const mctx = moneyOn(d, userId) ? moneyContext(d, userId, today) : null;
    const at = readSettings(d, userId).deadline_time;
    if (id === 'parse') {
      const phrase = text(body.text, 4000, 'Текст') as string;
      const raw = await askJson(d, userId, { system: prompt(d, userId, today, mctx), user: phrase, maxTokens: 3000 });
      const items = parseHub(raw, at, mctx, phrase);
      if (!items.length) throw new HttpError(422, 'Не понял, что записать. Скажите иначе, например: «кофе 350» или «завтра в 9 позвонить врачу».');
      return { items };
    }
    const m = typeof body.audio === 'string' ? /^data:audio\/([\w.+-]+)(?:;[^,]*)?;base64,(.+)$/.exec(body.audio) : null;
    const format = m ? AUDIO[m[1].toLowerCase()] : undefined;
    if (!m || !format || (body.audio as string).length > 4_000_000) throw new HttpError(400, 'Запись не подошла — попробуйте сказать короче.');
    const raw = (await askJson(d, userId, {
      model: audioModel(),
      system: `${prompt(d, userId, today, mctx)} Сначала дословно запиши, что сказал человек, в поле "said": {"said":"…","items":[…]}.`,
      user: [
        { type: 'text', text: 'Запись голоса:' },
        { type: 'input_audio', input_audio: { data: m[2], format } },
      ] as Part[],
      maxTokens: 3000,
    })) as { said?: unknown };
    const said = typeof raw?.said === 'string' ? raw.said.trim().slice(0, 4000) : '';
    const items = parseHub(raw, at, mctx, said || undefined).map((it) => (it.type === 'money' ? { ...it, draft: { ...it.draft, source: 'voice' } } : it));
    if (!items.length) throw new HttpError(422, said ? `Не понял, что записать из «${said.slice(0, 80)}».` : 'Ничего не расслышал. Попробуйте ещё раз.');
    return { said, items };
  }

  if (id === 'save') {
    if (!Array.isArray(body.items) || !body.items.length || body.items.length > 30) throw new HttpError(400, 'Нечего сохранить.');
    const call = (route: (c: Ctx) => unknown, path: [string?, string?], b: Record<string, unknown>) => route({ ...ctx, method: 'POST', body: b, id: path[0], action: path[1] });
    let saved = 0;
    const shopping: { name: string; qty: number | null; unit: string | null }[] = [];
    for (const raw of body.items as Record<string, unknown>[]) {
      const it = raw ?? {};
      if (it.type === 'task' || it.type === 'reminder') {
        const subtasks = Array.isArray(it.subtasks) ? (it.subtasks as unknown[]).map((s) => str(s, 120)).filter((s): s is string => !!s).slice(0, 20) : [];
        // Подзадачи — чек-лист, привязанный к делу (как в окне дела).
        const list = subtasks.length ? ((await call(checklists, [], { title: str(it.title, 80) ?? 'Подзадачи', icon: 'list', items: subtasks.map((t) => ({ title: t })) })) as { id: string }) : null;
        const common = { title: it.title, note: str(it.note, 2000), tags: it.tags, priority: it.priority, checklist_id: list?.id ?? null };
        if (it.type === 'task') await call(tasks, [], common);
        else await call(reminders, [], { ...common, times: it.times, rule: it.rule, nag: null });
        saved++;
      } else if (it.type === 'note') {
        await call(notes, [], { title: it.title, body: it.body });
        saved++;
      } else if (it.type === 'shopping') {
        const name = str(it.name, 60);
        if (name) shopping.push({ name, qty: typeof it.qty === 'number' ? it.qty : null, unit: str(it.unit, 10) });
      } else if (it.type === 'money') {
        await call(money, ['ops'], moneyBody(d, userId, (it.draft ?? {}) as MoneyDraft, body.money_account));
        saved++;
      }
    }
    if (shopping.length) {
      await call(kitchen, ['shopping'], { items: shopping });
      saved += shopping.length;
    }
    return { saved };
  }
  return undefined;
}

/**
 * Черновик траты → тело POST money/ops: счёт — названный, иначе последний,
 * которым платили, иначе первый свой; сумма в чужой валюте — по курсу ЦБ,
 * а исходная остаётся как «платил в другой валюте».
 */
function moneyBody(d: Ctx['d'], userId: string, draft: MoneyDraft, lastAccount: unknown): Record<string, unknown> {
  if (!moneyOn(d, userId)) throw new HttpError(403, '«Деньги» недоступны.');
  const accounts = readAccounts(d, userId).filter((a) => !a.archived);
  const acc =
    accounts.find((a) => a.id === draft.account_id) ??
    (draft.currency ? accounts.find((a) => a.mine && a.currency === draft.currency) : undefined) ??
    accounts.find((a) => a.id === lastAccount) ??
    accounts.find((a) => a.mine);
  if (!acc) throw new HttpError(400, 'Сначала заведите счёт в «Деньгах».');
  const amount = Number(draft.amount_minor);
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new HttpError(400, 'Неверная сумма.');
  let accAmount = amount;
  let orig: Record<string, unknown> = {};
  if (draft.currency && draft.currency !== acc.currency) {
    const { rates } = todayRates(d);
    const own = readUserRates(d, userId);
    const conv = convert(amount, draft.currency, acc.currency, (c) => (c === 'RUB' ? 1 : (rates[c] ?? own[c])));
    if (!conv) throw new HttpError(400, `Нет курса ${draft.currency} — укажите его в «Деньгах»: Ещё → Валюты.`);
    accAmount = conv;
    orig = { orig_amount_minor: amount, orig_currency: draft.currency };
  }
  return {
    kind: draft.kind === 'income' ? 'income' : 'expense',
    day: draft.day,
    account_id: acc.id,
    amount_minor: accAmount,
    category_id: draft.category_id ?? null,
    payee: draft.payee || null,
    note: draft.note || null,
    source: draft.source === 'voice' ? 'voice' : 'text',
    ...orig,
  };
}
