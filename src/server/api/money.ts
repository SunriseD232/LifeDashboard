import { readSettings } from '../settings';
import { randomUUID } from 'node:crypto';
import { userLogin } from '@/lib/auth';
import { isCurrency } from '@/lib/currencies';
import { ACCOUNT_KINDS, MODULES, normItem, OP_KINDS, type MoneyState, type OpKind } from '@/lib/money';
import { householdOf } from '../household';
import { DAY_RE, HttpError, text, type Ctx } from '../http';
import {
  moneyAllowed,
  readAccounts,
  readCategories,
  readItems,
  readMoneySettings,
  readOps,
  readUserRates,
  seedCategories,
  visibleAccount,
  visibleOp,
} from '../moneyStore';
import { refreshRates, todayRates } from '../moneyRates';
import { aiConfigured } from '../ai';
import { aiReceipt, aiText, aiVoice } from '../moneyAi';
import { checkRows, readJob, saveTemplate, startImport } from '../moneyImport';
import { ask, monthFlow, prices, readBudgets, readFamilyBudget, report, setBudget, setFamilyBudget, type Scope } from '../moneyReport';
import { PERIODS, type Period } from '@/lib/moneyReport';
import { validMapping } from '@/lib/moneyImport';
import { debts, goals, processRecurring, readDebts, readGoals, readRecurring, recurring } from '../moneyPlans';
import { smsCreate, smsDelete, smsPreview, smsSetAccount, smsStatus } from '../moneySms';
import { moscowDay } from '../moneyRates';
import { currencyCode, currencyList, insertOp, items, opFields, ownCategory, rememberCurrency, saveItems, settingsRequired, signedMinor } from '../moneyOps';

const MONTH_RE = /^\d{4}-\d{2}$/;

/** Последние 4 цифры карты для SMS: «1234» или пусто. */
function last4(v: unknown): string | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v !== 'string' || !/^\d{4}$/.test(v.trim())) throw new HttpError(400, 'Последние цифры карты — ровно 4 цифры.');
  return v.trim();
}

function monthRange(month: string): [string, string] {
  return [`${month}-01`, `${month}-31`];
}

/**
 * «Деньги»: /api/money/<раздел>[/<id>].
 *  GET    state?month=YYYY-MM       — всё для экрана;
 *  POST   onboard { base_currency, currencies, account? } — первый запуск;
 *  PATCH  settings { base_currency?, currencies?, hidden? };
 *  POST   accounts { name, kind, currency, opening_minor, shared } / PATCH accounts/:id / DELETE accounts/:id;
 *  POST   ops { kind, day, account_id, amount_minor, to_account_id?, to_amount_minor?, orig_*?, category_id?, payee?, note?, items? };
 *  GET    ops/:id — с позициями; PATCH ops/:id; DELETE ops/:id;
 *  POST   categories { kind, name } / PATCH categories/:id { name?, archived? };
 *  POST   rates { currency, rate } — свой курс для валюты без курса ЦБ;
 *  POST   ai/text { text, today } · ai/voice { audio, today } · ai/receipt { image, today } — черновики от ИИ;
 *  PATCH  ops/:id { only_items: true, items, category_id? } — позиции чека к записанной операции;
 *  POST   import/start { kind: 'file', name, data } | { kind: 'screens', images } → { job };
 *  GET    import/job?id= → { status, result?, error? }; POST import/check { account_id, rows } — повторы;
 *  POST   import/commit { account_id, rows, signature?, mapping?, bank? } — записать выбранное;
 *  GET    report?period=week|month|year&day=&scope= — отчёт; PUT budgets { category_id, limit_minor|null };
 *  GET    prices?q=|key= — цены товаров из чеков; POST ask { question, today } — вопрос ИИ о своих деньгах.
 * Пока раздел тестовый — только для MONEY_USERS (src/server/moneyStore.ts).
 */
export async function money({ d, userId, method, body, id: sub, action: id, req }: Ctx): Promise<unknown> {
  const login = userLogin(userId);
  if (!moneyAllowed(userId, login)) throw new HttpError(403, 'Раздел «Деньги» пока в тесте и открыт не всем.');

  if (sub === 'state' && method === 'GET') {
    const month = req.nextUrl.searchParams.get('month') ?? '';
    if (!MONTH_RE.test(month)) throw new HttpError(400, 'Неверный месяц.');
    // Курсы на сегодня — подождём недолго, иначе отдадим вчерашние.
    await Promise.race([refreshRates(d), new Promise((r) => setTimeout(r, 2500))]);
    // Наступившие регулярные платежи «записывать сам» — до чтения операций.
    if (readMoneySettings(d, userId)) processRecurring(d, userId, moscowDay());
    const { rates, day } = todayRates(d);
    const [from, to] = monthRange(month);
    const state: MoneyState = {
      settings: readMoneySettings(d, userId),
      accounts: readAccounts(d, userId),
      categories: readCategories(d, userId),
      ops: readOps(d, userId, from, to),
      month,
      rates: { ...rates, RUB: 1 },
      rates_day: day,
      user_rates: readUserRates(d, userId),
      family: !!householdOf(d, userId),
      login,
      nav: readSettings(d, userId).nav,
      ai: aiConfigured(),
      budgets: [],
      month_parts: [],
      prev_spend: { mine: 0, family: 0 },
      recurring: [],
      debts: [],
      goals: [],
      family_budget: null,
      sms_on: false,
    };
    if (state.settings) {
      Object.assign(state, {
        budgets: readBudgets(d, userId),
        ...monthFlow(d, userId, month),
        recurring: readRecurring(d, userId),
        debts: readDebts(d, userId),
        goals: readGoals(d, userId),
        family_budget: readFamilyBudget(d, userId),
        sms_on: smsStatus(d, userId).on,
      });
    }
    return state;
  }

  if (sub === 'ai' && method === 'POST') {
    if (!aiConfigured()) throw new HttpError(503, 'ИИ пока не подключён.');
    if (id === 'text') return aiText(d, userId, body);
    if (id === 'voice') return aiVoice(d, userId, body);
    if (id === 'receipt') return aiReceipt(d, userId, body);
    return undefined;
  }

  if (sub === 'onboard' && method === 'POST') {
    const base = currencyCode(body.base_currency);
    const list = currencyList(body.currencies ?? []).filter((c) => c !== base);
    d.transaction(() => {
      d.prepare(
        `insert into money_settings (user_id, base_currency, currencies) values (?, ?, ?)
         on conflict (user_id) do update set base_currency = excluded.base_currency, currencies = excluded.currencies`,
      ).run(userId, base, JSON.stringify(list));
      seedCategories(d, userId);
      // Первый счёт — чтобы сразу можно было записать трату.
      if (!d.prepare('select 1 from money_accounts where user_id = ? limit 1').get(userId)) {
        const a = (body.account ?? {}) as Record<string, unknown>;
        d.prepare('insert into money_accounts (id, user_id, name, kind, currency, opening_minor) values (?, ?, ?, ?, ?, ?)').run(
          randomUUID(),
          userId,
          text(a.name, 60, 'Название счёта', true) ?? 'Карта',
          'card',
          a.currency ? currencyCode(a.currency) : base,
          signedMinor(a.opening_minor, 'Остаток'),
        );
      }
    })();
    return { ok: true };
  }

  if (sub === 'settings' && method === 'PATCH') {
    const s = settingsRequired(d, userId);
    const base = body.base_currency !== undefined ? currencyCode(body.base_currency) : s.base_currency;
    const list = (body.currencies !== undefined ? currencyList(body.currencies) : s.currencies).filter((c) => c !== base);
    let hidden = s.hidden;
    if (body.hidden !== undefined) {
      if (!Array.isArray(body.hidden)) throw new HttpError(400, 'Неверный список.');
      const known = new Set(MODULES.map((m) => m.id));
      hidden = [...new Set((body.hidden as unknown[]).filter((h): h is string => typeof h === 'string' && known.has(h)))];
    }
    d.prepare('update money_settings set base_currency = ?, currencies = ?, hidden = ? where user_id = ?').run(base, JSON.stringify(list), JSON.stringify(hidden), userId);
    return { ok: true };
  }

  if (sub === 'accounts') {
    settingsRequired(d, userId);
    if (method === 'POST' && !id) {
      const kind = ACCOUNT_KINDS.some((k) => k.id === body.kind) ? body.kind : 'card';
      const cur = currencyCode(body.currency);
      const hh = body.shared ? householdOf(d, userId) : null;
      if (body.shared && !hh) throw new HttpError(400, 'Семейный счёт можно завести, когда вы в семье (Настройки LifeDashboard → Семья).');
      const pos = ((d.prepare('select max(position) as m from money_accounts where user_id = ?').get(userId) as { m: number | null }).m ?? -1) + 1;
      const aid = randomUUID();
      d.prepare('insert into money_accounts (id, user_id, household_id, name, kind, currency, opening_minor, position) values (?, ?, ?, ?, ?, ?, ?, ?)').run(
        aid,
        userId,
        hh,
        text(body.name, 60, 'Название счёта'),
        kind,
        cur,
        signedMinor(body.opening_minor, 'Остаток'),
        pos,
      );
      if (body.card_last4) d.prepare('update money_accounts set card_last4 = ? where id = ?').run(last4(body.card_last4), aid);
      rememberCurrency(d, userId, cur);
      return { id: aid };
    }
    const acc = d.prepare('select * from money_accounts where id = ? and user_id = ?').get(id ?? '', userId) as { id: string; currency: string } | undefined;
    if (!acc) throw new HttpError(visibleAccount(d, userId, id) ? 403 : 404, visibleAccount(d, userId, id) ? 'Менять семейный счёт может тот, кто его завёл.' : 'Счёт не найден.');
    if (method === 'PATCH') {
      if (body.name !== undefined) d.prepare('update money_accounts set name = ? where id = ?').run(text(body.name, 60, 'Название счёта'), acc.id);
      if (body.kind !== undefined && ACCOUNT_KINDS.some((k) => k.id === body.kind)) d.prepare('update money_accounts set kind = ? where id = ?').run(body.kind, acc.id);
      if (body.card_last4 !== undefined) d.prepare('update money_accounts set card_last4 = ? where id = ?').run(last4(body.card_last4), acc.id);
      if (body.opening_minor !== undefined) d.prepare('update money_accounts set opening_minor = ? where id = ?').run(signedMinor(body.opening_minor, 'Остаток'), acc.id);
      if (body.archived !== undefined) d.prepare('update money_accounts set archived = ? where id = ?').run(body.archived ? 1 : 0, acc.id);
      if (body.shared !== undefined) {
        const hh = body.shared ? householdOf(d, userId) : null;
        if (body.shared && !hh) throw new HttpError(400, 'Семейный счёт можно завести, когда вы в семье.');
        d.prepare('update money_accounts set household_id = ? where id = ?').run(hh, acc.id);
      }
      if (body.currency !== undefined && body.currency !== acc.currency) {
        const used = d.prepare('select 1 from money_ops where account_id = ? or to_account_id = ? limit 1').get(acc.id, acc.id);
        if (used) throw new HttpError(400, 'На счёте уже есть операции — валюту не поменять. Заведите новый счёт.');
        const cur = currencyCode(body.currency);
        d.prepare('update money_accounts set currency = ? where id = ?').run(cur, acc.id);
        rememberCurrency(d, userId, cur);
      }
      return { ok: true };
    }
    if (method === 'DELETE') {
      const used = d.prepare('select 1 from money_ops where account_id = ? or to_account_id = ? limit 1').get(acc.id, acc.id);
      if (used) throw new HttpError(400, 'На счёте есть операции — его можно только убрать в архив.');
      d.prepare('delete from money_accounts where id = ?').run(acc.id);
      return { ok: true };
    }
  }

  if (sub === 'ops') {
    settingsRequired(d, userId);
    if (method === 'POST' && !id) {
      const f = opFields(d, userId, body);
      const list = items(d, userId, body.items);
      const source = ['manual', 'text', 'voice', 'photo', 'import', 'sms'].includes(body.source) ? body.source : 'manual';
      // Тот же чек второй раз (не увидели первый — он лёг в другой месяц) — спросить.
      if (source === 'photo' && !body.force) {
        const same = d
          .prepare("select payee, day from money_ops where account_id = ? and day = ? and amount_minor = ? and kind = 'expense' and source = 'photo' limit 1")
          .get(f.account_id, f.day, f.amount_minor) as { payee: string | null; day: string } | undefined;
        if (same) {
          const when = new Date(`${same.day}T12:00:00Z`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', timeZone: 'UTC' });
          throw new HttpError(409, `Этот чек уже записан: ${same.payee ?? 'покупка'}, ${when}.`);
        }
      }
      const oid = randomUUID();
      d.transaction(() => {
        d.prepare(
          `insert into money_ops (id, user_id, kind, day, account_id, amount_minor, currency, to_account_id, to_amount_minor, to_currency,
             orig_amount_minor, orig_currency, category_id, payee, note, source)
           values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(oid, userId, f.kind, f.day, f.account_id, f.amount_minor, f.currency, f.to_account_id, f.to_amount_minor, f.to_currency, f.orig_amount_minor, f.orig_currency, f.category_id, f.payee, f.note, source);
        if (list.length) saveItems(d, oid, list);
      })();
      return { id: oid };
    }
    const op = visibleOp(d, userId, id);
    if (!op) throw new HttpError(404, 'Операция не найдена.');
    if (method === 'GET') return { items: readItems(d, op.id) };
    if (method === 'PATCH' && body.only_items) {
      // Позиции чека к уже записанной операции (например, к трате из банка).
      const list = items(d, userId, body.items);
      d.transaction(() => {
        saveItems(d, op.id, list);
        if (body.category_id !== undefined && !op.category_id && op.kind === 'expense') {
          d.prepare('update money_ops set category_id = ? where id = ?').run(ownCategory(d, userId, body.category_id, 'expense'), op.id);
        }
        d.prepare("update money_ops set updated_at = datetime('now') where id = ?").run(op.id);
      })();
      return { ok: true };
    }
    if (method === 'PATCH') {
      const f = opFields(d, userId, body, op.category_id);
      d.transaction(() => {
        d.prepare(
          `update money_ops set kind = ?, day = ?, account_id = ?, amount_minor = ?, currency = ?, to_account_id = ?, to_amount_minor = ?,
             to_currency = ?, orig_amount_minor = ?, orig_currency = ?, category_id = ?, payee = ?, note = ?, updated_at = datetime('now')
           where id = ?`,
        ).run(f.kind, f.day, f.account_id, f.amount_minor, f.currency, f.to_account_id, f.to_amount_minor, f.to_currency, f.orig_amount_minor, f.orig_currency, f.category_id, f.payee, f.note, op.id);
        if (body.items !== undefined) saveItems(d, op.id, items(d, userId, body.items));
      })();
      return { ok: true };
    }
    if (method === 'DELETE') {
      d.prepare('delete from money_ops where id = ?').run(op.id);
      return { ok: true };
    }
  }

  if (sub === 'categories') {
    settingsRequired(d, userId);
    if (method === 'POST' && !id) {
      const kind = body.kind === 'income' ? 'income' : 'expense';
      const name = text(body.name, 40, 'Категория') as string;
      const pos = ((d.prepare('select max(position) as m from money_categories where user_id = ? and kind = ?').get(userId, kind) as { m: number | null }).m ?? -1) + 1;
      const cid = randomUUID();
      d.prepare('insert into money_categories (id, user_id, kind, name, position) values (?, ?, ?, ?, ?)').run(cid, userId, kind, name, pos);
      return { id: cid };
    }
    const cat = d.prepare('select id from money_categories where id = ? and user_id = ?').get(id ?? '', userId) as { id: string } | undefined;
    if (!cat) throw new HttpError(404, 'Категория не найдена.');
    if (method === 'PATCH') {
      if (body.name !== undefined) d.prepare('update money_categories set name = ? where id = ?').run(text(body.name, 40, 'Категория'), cat.id);
      // Удалить нельзя — в операциях останется ссылка; убираем из списков.
      if (body.archived !== undefined) d.prepare('update money_categories set archived = ? where id = ?').run(body.archived ? 1 : 0, cat.id);
      return { ok: true };
    }
  }

  if (sub === 'recurring') {
    settingsRequired(d, userId);
    return recurring(d, userId, method, id, typeof body.do === 'string' ? body.do : undefined, body, moscowDay());
  }
  if (sub === 'debts') {
    settingsRequired(d, userId);
    return debts(d, userId, method, id, typeof body.do === 'string' ? body.do : undefined, body);
  }
  if (sub === 'goals') {
    settingsRequired(d, userId);
    return goals(d, userId, method, id, body);
  }
  if (sub === 'sms') {
    settingsRequired(d, userId);
    if (method === 'GET' && !id) return smsStatus(d, userId);
    if (method === 'POST' && !id) return smsCreate(d, userId, body.account_id);
    if (method === 'PATCH' && !id) return smsSetAccount(d, userId, body.account_id);
    if (method === 'DELETE' && !id) return smsDelete(d, userId);
    if (method === 'POST' && id === 'preview') return smsPreview(d, userId, body);
  }

  if (sub === 'report' && method === 'GET') {
    settingsRequired(d, userId);
    const q = req.nextUrl.searchParams;
    const period = (PERIODS.includes(q.get('period') as Period) ? q.get('period') : 'month') as Period;
    const anchor = q.get('day') ?? '';
    if (!DAY_RE.test(anchor)) throw new HttpError(400, 'Неверная дата.');
    const scope = (['mine', 'family', 'all'].includes(q.get('scope') ?? '') ? q.get('scope') : 'all') as Scope;
    return report(d, userId, period, anchor, scope);
  }
  if (sub === 'budgets' && method === 'PUT') {
    settingsRequired(d, userId);
    return setBudget(d, userId, body);
  }
  if (sub === 'family-budget' && method === 'PUT') {
    settingsRequired(d, userId);
    return setFamilyBudget(d, userId, body);
  }
  if (sub === 'prices' && method === 'GET') {
    settingsRequired(d, userId);
    const q = req.nextUrl.searchParams;
    return prices(d, userId, (q.get('q') ?? '').slice(0, 60), q.get('key'));
  }
  if (sub === 'ask' && method === 'POST') {
    settingsRequired(d, userId);
    if (!aiConfigured()) throw new HttpError(503, 'ИИ пока не подключён.');
    return ask(d, userId, body);
  }

  if (sub === 'import') {
    settingsRequired(d, userId);
    if (id === 'start' && method === 'POST') return startImport(d, userId, body);
    if (id === 'job' && method === 'GET') return readJob(userId, req.nextUrl.searchParams.get('id') ?? undefined);
    if (id === 'check' && method === 'POST') {
      if (!Array.isArray(body.rows) || body.rows.length > 2000) throw new HttpError(400, 'Неверный список строк.');
      const rows = (body.rows as Record<string, unknown>[]).map((r) => ({ key: String(r?.key ?? ''), day: String(r?.day ?? ''), amount_minor: Number(r?.amount_minor) }));
      return { rows: checkRows(d, userId, String(body.account_id ?? ''), rows) };
    }
    if (id === 'commit' && method === 'POST') return commitImport(d, userId, body);
  }

  if (sub === 'rates' && method === 'POST') {
    const cur = currencyCode(body.currency);
    const rate = Number(body.rate);
    if (!Number.isFinite(rate) || rate <= 0 || rate > 1e9) throw new HttpError(400, 'Неверный курс.');
    d.prepare(
      `insert into money_user_rates (user_id, currency, rate) values (?, ?, ?)
       on conflict (user_id, currency) do update set rate = excluded.rate, updated_at = datetime('now')`,
    ).run(userId, cur, rate);
    return { ok: true };
  }

  return undefined;
}

/**
 * Записать выбранные строки выписки. new — новая операция (с ключом строки,
 * чтобы повторный импорт её не задвоил), link — строка уже записана вручную:
 * ставим ключ на ту операцию. Всё одной транзакцией.
 */
function commitImport(d: Ctx['d'], userId: string, body: Record<string, unknown>) {
  const acc = d.prepare('select id, currency from money_accounts where id = ? and user_id = ?').get(body.account_id ?? '', userId) as { id: string; currency: string } | undefined;
  if (!acc) throw new HttpError(400, 'Выберите свой счёт для выписки.');
  if (!Array.isArray(body.rows) || !body.rows.length || body.rows.length > 2000) throw new HttpError(400, 'Нечего импортировать.');
  let added = 0;
  let linked = 0;
  const insert = d.prepare(
    `insert into money_ops (id, user_id, kind, day, account_id, amount_minor, currency, to_account_id, to_amount_minor, to_currency,
       orig_amount_minor, orig_currency, category_id, payee, note, source, import_key)
     values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'import', ?)`,
  );
  d.transaction(() => {
    for (const raw of body.rows as Record<string, unknown>[]) {
      const r = raw ?? {};
      const key = text(r.key, 300, 'Ключ строки') as string;
      if (r.action === 'link') {
        const op = visibleOp(d, userId, r.link_id);
        if (!op) throw new HttpError(400, 'Операция для склейки не найдена — обновите импорт.');
        d.prepare("update money_ops set import_key = ?, updated_at = datetime('now') where id = ? and (import_key is null or source = 'sms')").run(key, op.id);
        linked++;
        continue;
      }
      const signed = Number(r.amount_minor);
      if (!Number.isSafeInteger(signed) || signed === 0) throw new HttpError(400, 'Неверная сумма в строке выписки.');
      const kind = r.kind === 'transfer' ? 'transfer' : signed < 0 ? 'expense' : 'income';
      // Перевод: списание — с этого счёта на другой, поступление — с другого на этот.
      const other = kind === 'transfer' ? r.to_account_id : null;
      const f = opFields(d, userId, {
        kind,
        day: r.day,
        account_id: kind === 'transfer' && signed > 0 ? other : acc.id,
        to_account_id: kind === 'transfer' ? (signed > 0 ? acc.id : other) : null,
        amount_minor: Math.abs(signed),
        category_id: r.category_id,
        payee: r.payee,
        note: r.note,
        orig_amount_minor: r.orig_amount_minor,
        orig_currency: r.orig_currency,
      });
      insert.run(randomUUID(), userId, f.kind, f.day, f.account_id, f.amount_minor, f.currency, f.to_account_id, f.to_amount_minor, f.to_currency, f.orig_amount_minor, f.orig_currency, f.category_id, f.payee, f.note, key);
      added++;
    }
    const mapping = body.mapping ? validMapping(body.mapping, 500, 100000) : null;
    saveTemplate(d, userId, typeof body.signature === 'string' ? body.signature : null, mapping, body.bank, acc.id);
  })();
  return { added, linked };
}
