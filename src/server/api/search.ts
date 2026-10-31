import { userLogin } from '@/lib/auth';
import { money } from '@/lib/currencies';
import { matches, MARK_END, MARK_START, toMatch, words, type SearchHit, type SearchKind } from '@/lib/search';
import { householdOf } from '../household';
import type { Ctx } from '../http';
import { moneyAllowed, readAccounts, readMoneySettings } from '../moneyStore';
import { readVacationList } from '../vacationStore';
import type Database from 'better-sqlite3';

const LIMIT = 60;

interface Row {
  kind: SearchKind;
  ref_id: string;
  title: string;
  snippet: string;
}

/**
 * Поиск по всему своему и общему: /api/search?q=. Индекс ведут триггеры
 * (миграция 5); здесь — запрос, видимость и названия чек-листов для пунктов.
 * Кусок текста — из «тела» (текст заметки, метка и заметка дела, группа
 * пункта): название и так показано строкой выше.
 */
export function search({ d, userId, method, id, req }: Ctx): unknown {
  if (method !== 'GET' || id) return undefined;
  const q = req.nextUrl.searchParams.get('q') ?? '';
  const match = toMatch(q);
  // Пустой запрос — окно поиска только спрашивает, есть ли «Деньги» (для быстрых действий).
  const withMoney = moneyAllowed(userId, userLogin(userId)) && !!readMoneySettings(d, userId);
  if (!match) return { results: [], money: withMoney };
  const hh = householdOf(d, userId);
  const rows = d
    .prepare(
      `select kind, ref_id, title, snippet(search_fts, 1, ?, ?, '…', 10) as snippet
       from search_fts
       where search_fts match ? and (user_id = ? or (household_id is not null and household_id = ?))
       order by rank
       limit ?`,
    )
    .all(MARK_START, MARK_END, match, userId, hh, LIMIT) as Row[];

  // Пункту чек-листа нужен его чек-лист — чтобы открыть и подписать.
  const itemIds = rows.filter((r) => r.kind === 'item').map((r) => r.ref_id);
  const parents = new Map<string, { id: string; title: string }>();
  if (itemIds.length) {
    const found = d
      .prepare(
        `select i.id, c.id as cid, c.title from checklist_items i join checklists c on c.id = i.checklist_id
         where i.id in (select value from json_each(?))`,
      )
      .all(JSON.stringify(itemIds)) as { id: string; cid: string; title: string }[];
    for (const f of found) parents.set(f.id, { id: f.cid, title: f.title });
  }

  const results: SearchHit[] = rows.map((r) => ({
    kind: r.kind,
    id: r.ref_id,
    title: r.title,
    snippet: r.snippet,
    ...(r.kind === 'item' && parents.get(r.ref_id) ? { parent: parents.get(r.ref_id) } : {}),
  }));
  return { results: [...results, ...extra(d, userId, words(q), withMoney)], money: withMoney };
}

const MONTHS = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const dm = (day: string) => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}${day.slice(0, 4) !== new Date().toISOString().slice(0, 4) ? ` ${day.slice(0, 4)}` : ''}`;
const EXTRA_LIMIT = 15;

/**
 * Разделы вне полнотекстового индекса: отпуска, тренировки и «Деньги».
 * Их немного, поэтому совпадения ищем прямо здесь — тем же правилом, что и
 * индекс (src/lib/search.ts, matches).
 */
function extra(d: Database.Database, userId: string, q: string[], withMoney: boolean): SearchHit[] {
  const out: SearchHit[] = [];
  const add = (kind: SearchKind, rows: { id: string; title: string; text: string; snippet: string; month?: string }[]) => {
    out.push(
      ...rows
        .filter((x) => matches(x.text, q))
        .slice(0, EXTRA_LIMIT)
        .map((x) => ({ kind, id: x.id, title: x.title, snippet: x.snippet, ...(x.month ? { month: x.month } : {}) })),
    );
  };

  add(
    'vacation',
    readVacationList(d, userId).map((v) => ({ id: v.id, title: v.title, text: `${v.title} отпуск`, snippet: `${dm(v.start)} – ${dm(v.end)}` })),
  );
  add(
    'workout',
    (d.prepare('select id, title from workout_templates where user_id = ?').all(userId) as { id: string; title: string }[]).map((t) => ({ id: t.id, title: t.title, text: `${t.title} тренировка`, snippet: 'шаблон тренировки' })),
  );
  if (!withMoney) return out;

  const accounts = readAccounts(d, userId);
  const visible = accounts.map((a) => a.id);
  add(
    'account',
    accounts.map((a) => ({ id: a.id, title: a.name, text: `${a.name} счёт ${a.card_last4 ?? ''}`, snippet: `${money(a.balance_minor, a.currency)}${a.archived ? ' · в архиве' : ''}` })),
  );
  // Операции — свежие сверху, с последних трёх лет: по магазину, заметке, категории.
  const ops = d
    .prepare(
      `select o.id, o.kind, o.day, o.amount_minor, o.currency, o.payee, o.note, c.name as category
       from money_ops o left join money_categories c on c.id = o.category_id
       where (o.account_id in (select value from json_each(?)) or o.to_account_id in (select value from json_each(?)))
         and o.day >= date('now', '-3 year')
       order by o.day desc, o.created_at desc limit 5000`,
    )
    .all(JSON.stringify(visible), JSON.stringify(visible)) as { id: string; kind: string; day: string; amount_minor: number; currency: string; payee: string | null; note: string | null; category: string | null }[];
  const sign = (k: string) => (k === 'expense' ? '−' : k === 'income' ? '+' : '');
  add(
    'op',
    ops.map((o) => ({
      id: o.id,
      title: o.payee || o.category || (o.kind === 'income' ? 'Доход' : o.kind === 'expense' ? 'Расход' : 'Перевод'),
      text: [o.payee, o.note, o.category].filter(Boolean).join(' '),
      snippet: [`${sign(o.kind)}${money(o.amount_minor, o.currency)}`, dm(o.day), o.payee ? o.category : null, o.note].filter(Boolean).join(' · '),
      month: o.day.slice(0, 7),
    })),
  );
  add(
    'debt',
    (d.prepare('select id, person, direction, amount_minor, currency, note, closed from money_debts where user_id = ?').all(userId) as { id: string; person: string; direction: string; amount_minor: number; currency: string; note: string | null; closed: number }[]).map((x) => ({
      id: x.id,
      title: x.person,
      text: `${x.person} ${x.note ?? ''} долг`,
      snippet: `${x.direction === 'lent' ? 'вам должны' : 'вы должны'} ${money(x.amount_minor, x.currency)}${x.closed ? ' · закрыт' : ''}`,
    })),
  );
  add(
    'goal',
    (d.prepare('select id, name, target_minor, saved_minor, currency from money_goals where user_id = ? and archived = 0').all(userId) as { id: string; name: string; target_minor: number; saved_minor: number; currency: string }[]).map((g) => ({
      id: g.id,
      title: g.name,
      text: `${g.name} цель`,
      snippet: `${money(g.saved_minor, g.currency)} из ${money(g.target_minor, g.currency)}`,
    })),
  );
  return out;
}
