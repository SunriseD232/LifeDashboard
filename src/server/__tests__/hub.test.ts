import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '@/lib/migrations';

let current: Database.Database;
vi.mock('@/lib/db', () => ({ db: () => current }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => {} }) }));

const { hub } = await import('../api/hub');
const { money } = await import('../api/money');
const { setAiTransport } = await import('../ai');
const { resetRatesClock, setRatesTransport, saveRates, moscowDay } = await import('../moneyRates');
import type { Ctx } from '../http';

function setup() {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  migrate(d);
  d.prepare("insert into users (id, login, password_hash) values ('me', 'me@x', 'x')").run();
  current = d;
  return d;
}
const ctx = (method: string, route: [string?, string?], body: Record<string, unknown> = {}, query = '') =>
  ({ d: current, userId: 'me', method, body, id: route[0], action: route[1], req: { nextUrl: new URL(`http://x/${query}`) } }) as unknown as Ctx;
const callHub = (id: string, body: Record<string, unknown>) => hub(ctx('POST', [id], body)) as Promise<any>;
const callMoney = (method: string, route: [string?, string?], body: Record<string, unknown> = {}, q = '') => money(ctx(method, route, body, q)) as Promise<any>;

let replies: string[] = [];
let asked: { system: string; model?: string }[] = [];
beforeEach(() => {
  process.env.MONEY_USERS = '*';
  process.env.AI_DAILY_LIMIT = '50';
  resetRatesClock();
  setRatesTransport(async () => ({ ok: false, text: async () => '' }));
  replies = [];
  asked = [];
  setAiTransport(async (req) => {
    asked.push(req as never);
    return replies.shift() ?? '{}';
  });
});
afterEach(() => setAiTransport(null));

const LONG =
  'Надо до 15 ноября подготовить документы на вычет за лечение: взять в клинике справку об оплате и копию лицензии, найти договор, собрать чеки из аптеки и отнести всё в МФЦ.';

describe('главная: одна строка на всё', () => {
  it('фраза → дело с описанием и подзадачами, напоминание, покупка и трата; сохраняется разом', async () => {
    setup();
    await callMoney('POST', ['onboard'], { base_currency: 'RUB', currencies: ['EUR'] });
    const s = await callMoney('GET', ['state'], {}, `?month=${moscowDay().slice(0, 7)}`);
    const card = s.accounts[0];
    replies.push(
      JSON.stringify({
        items: [
          { type: 'task', title: 'Документы на вычет за лечение', note: LONG, subtasks: ['Справка из клиники', 'Найти договор', 'Чеки из аптеки', 'Отнести в МФЦ'], tags: [], priority: 0 },
          { type: 'reminder', title: 'Позвонить маме', times: ['18:00'], rule: { kind: 'once', date: '2026-11-01' }, note: null, subtasks: [] },
          { type: 'shopping', name: 'Молоко', qty: null, unit: null },
          { type: 'money', kind: 'expense', amount: 12, currency: 'EUR', category: 'Кафе', payee: 'Кофе', date: '2026-10-31' },
        ],
      }),
    );
    const { items } = await callHub('parse', { text: `${LONG} Завтра в 18 позвонить маме, купить молоко, кофе 12 евро`, today: '2026-10-31' });
    expect(items.map((i: { type: string }) => i.type)).toEqual(['task', 'reminder', 'shopping', 'money']);
    expect(items[0]).toMatchObject({ title: 'Документы на вычет за лечение', note: LONG, subtasks: ['Справка из клиники', 'Найти договор', 'Чеки из аптеки', 'Отнести в МФЦ'] });
    expect(items[3].draft).toMatchObject({ amount_minor: 1200, currency: 'EUR', payee: 'Кофе' });
    // В подсказке модели — счета «Денег» и правило про длинный текст.
    expect(asked[0].system).toContain('«Карта» (RUB)');
    expect(asked[0].system).toContain('ДЛИННЫЙ ТЕКСТ');

    saveRates(current, { day: moscowDay(), rates: { EUR: 94.4 } });
    const r = await callHub('save', { items, money_account: card.id });
    expect(r).toEqual({ saved: 4 });
    const task = current.prepare('select title, note, checklist_id from tasks').get() as { title: string; note: string; checklist_id: string };
    expect(task).toMatchObject({ title: 'Документы на вычет за лечение', note: LONG });
    const subs = current.prepare('select title from checklist_items where checklist_id = ? order by position').all(task.checklist_id) as { title: string }[];
    expect(subs.map((x) => x.title)).toEqual(['Справка из клиники', 'Найти договор', 'Чеки из аптеки', 'Отнести в МФЦ']);
    expect(current.prepare('select title, times from reminders').get()).toMatchObject({ title: 'Позвонить маме', times: '["18:00"]' });
    expect(current.prepare("select count(*) n from checklist_items where title = 'молоко'").get()).toEqual({ n: 1 });
    // 12 € на рублёвую карту — по курсу ЦБ, исходная сумма сохраняется.
    expect(current.prepare('select amount_minor, orig_amount_minor, orig_currency, payee, source from money_ops').get()).toEqual({
      amount_minor: 113280,
      orig_amount_minor: 1200,
      orig_currency: 'EUR',
      payee: 'Кофе',
      source: 'text',
    });
  });

  it('длинный текст — в описание целиком, срок «до 15 ноября» — напоминанием в этот день', async () => {
    setup();
    replies.push(JSON.stringify({ items: [{ type: 'task', title: 'Документы на вычет', due_date: '2026-11-15', note: 'Подготовить документы', subtasks: ['Справка', 'Договор'] }] }));
    const { items } = await callHub('parse', { text: LONG, today: '2026-10-31' });
    expect(items[0]).toMatchObject({ type: 'reminder', title: 'Документы на вычет', rule: { kind: 'once', date: '2026-11-15' }, note: LONG, subtasks: ['Справка', 'Договор'] });
    // Короткая фраза — описание не трогаем.
    replies.push(JSON.stringify({ items: [{ type: 'task', title: 'Позвонить', note: null, subtasks: [] }] }));
    expect((await callHub('parse', { text: 'позвонить маме', today: '2026-10-31' })).items[0].note).toBeNull();
  });

  it('без «Денег» трат не предлагает; голос — модель со звуком', async () => {
    setup();
    replies.push(JSON.stringify({ said: 'кофе триста и купить хлеб', items: [{ type: 'money', kind: 'expense', amount: 300 }, { type: 'shopping', name: 'хлеб' }] }));
    const r = await callHub('voice', { audio: 'data:audio/mp4;base64,AAAA', today: '2026-10-31' });
    expect(r.said).toBe('кофе триста и купить хлеб');
    expect(r.items.map((i: { type: string }) => i.type)).toEqual(['shopping']);
    expect(asked[0].model).toBe('google/gemini-3.5-flash-lite');
    expect(asked[0].system).not.toContain('"type":"money"');
    replies.push('{"items":[]}');
    await expect(callHub('parse', { text: 'привет', today: '2026-10-31' })).rejects.toMatchObject({ status: 422 });
  });
});
