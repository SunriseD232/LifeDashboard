import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '@/lib/migrations';

// В тестах база — своя, а не файл приложения.
let current: Database.Database;
vi.mock('@/lib/db', () => ({ db: () => current }));
vi.mock('next/headers', () => ({ cookies: () => ({ get: () => undefined, set: () => {} }) }));

const { setAiTransport } = await import('../ai');
const { ai } = await import('../api/ai');
const { support } = await import('../api/support');
const { kitchen } = await import('../api/kitchen');
const { dayWord, fixDayWords } = await import('../summary');
import type { Ctx } from '../http';

function setup() {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  migrate(d);
  const user = d.prepare("insert into users (id, login, password_hash) values (?, ?, 'x')");
  user.run('me', 'me@example.com');
  user.run('boss', 'boss@example.com');
  current = d;
  return d;
}
const call = (fn: (c: Ctx) => unknown, d: Database.Database, userId: string, method: string, path: (string | undefined)[], body: Record<string, unknown> = {}) =>
  fn({ d, userId, method, body, id: path[0], action: path[1], req: { nextUrl: new URL('http://x/') } } as unknown as Ctx) as Promise<never>;

let replies: string[] = [];
let asked: unknown[] = [];
beforeEach(() => {
  replies = [];
  asked = [];
  setAiTransport(async (req) => {
    asked.push(req);
    return replies.shift() ?? '{}';
  });
  process.env.AI_DAILY_LIMIT = '3';
  process.env.ADMIN_LOGINS = 'boss@example.com';
});
afterEach(() => setAiTransport(null));

describe('ИИ', () => {
  it('фраза → проверенные записи', async () => {
    const d = setup();
    replies.push(
      '```json\n{"items":[{"type":"reminder","title":"Бассейн","times":["18:30"],"rule":{"kind":"repeat","unit":"week","every":1,"start":"2026-10-02","weekdays":[2,4]}},{"type":"task","title":"Купить подарок","due_date":"2026-10-03"}]}\n```',
    );
    const r = (await call(ai, d, 'me', 'POST', ['quick-add'], { text: 'по вт и чт бассейн в 18:30, завтра купить подарок', today: '2026-10-02' })) as { items: unknown[] };
    expect(r.items).toHaveLength(2);
    expect(JSON.stringify(asked[0])).toContain('2026-10-02');
  });

  it('сводка на выбранный день — про этот день, не про сегодня', async () => {
    const d = setup();
    d.prepare("insert into tasks (id, user_id, title, due_date) values ('t1', 'me', 'Сдать паспорт', '2026-10-08')").run();
    d.prepare("insert into tasks (id, user_id, title, due_date) values ('t2', 'me', 'Сегодняшнее', '2026-10-04')").run();
    replies.push('{"text":"В четверг — сдать паспорт."}');
    const r = (await call(ai, d, 'me', 'POST', ['summary'], { today: '2026-10-04', day: '2026-10-08' })) as { text: string };
    expect(r.text).toContain('паспорт');
    const facts = JSON.stringify(asked[0]);
    expect(facts).toContain('2026-10-08');
    expect(facts).toContain('Дела со сроком в этот день (1): Сдать паспорт');
    // Сегодняшнее — только как «до этого дня ещё сроки», не как дело того дня.
    expect(facts).toContain('До этого дня ещё сроки: Сегодняшнее');
  });

  it('день в сводке называется правильно, «сегодня» про другой день исправляется', async () => {
    expect(dayWord('2026-10-04', '2026-10-04')).toBe('сегодня');
    expect(dayWord('2026-10-05', '2026-10-04')).toBe('завтра');
    expect(dayWord('2026-10-18', '2026-10-04')).toBe('в воскресенье, 18 октября');
    expect(fixDayWords('Сегодня две встречи, а сегодня вечером бассейн.', '2026-10-18', '2026-10-04')).toBe(
      'В воскресенье, 18 октября две встречи, а в воскресенье, 18 октября вечером бассейн.',
    );
    expect(fixDayWords('Сегодня отчёт.', '2026-10-05', '2026-10-04')).toBe('Завтра отчёт.');
    expect(fixDayWords('Сегодня отчёт, завтра врач.', '2026-10-04', '2026-10-04')).toBe('Сегодня отчёт, завтра врач.');
    // В запросе к модели — как называть день, и нет слова «сегодня» в фактах.
    const d = setup();
    replies.push('{"text":"Сегодня две встречи."}');
    const r = (await call(ai, d, 'me', 'POST', ['summary'], { today: '2026-10-04', day: '2026-10-18' })) as { text: string };
    expect(r.text).toBe('В воскресенье, 18 октября две встречи.');
    const req = asked[0] as { system: string; user: string };
    expect(req.system).toContain('«в воскресенье, 18 октября»');
    expect(req.user).not.toMatch(/сегодня/i);
  });

  it('пустой разбор — понятная ошибка, а не пустой экран', async () => {
    const d = setup();
    replies.push('{"items":[{"type":"чепуха"}]}');
    await expect(call(ai, d, 'me', 'POST', ['quick-add'], { text: 'бла', today: '2026-10-02' })).rejects.toThrow(/Не понял/);
  });

  it('лимит запросов в сутки', async () => {
    const d = setup();
    for (let i = 0; i < 3; i++) {
      replies.push('{"items":[{"type":"task","title":"x"}]}');
      await call(ai, d, 'me', 'POST', ['quick-add'], { text: 'x', today: '2026-10-02' });
    }
    await expect(call(ai, d, 'me', 'POST', ['quick-add'], { text: 'x', today: '2026-10-02' })).rejects.toThrow(/закончились/);
  });

  it('меню — только из своих рецептов, плюс чего не хватает', async () => {
    const d = setup();
    await call(kitchen, d, 'me', 'POST', ['seed']);
    const recipes = d.prepare('select id, title from recipes').all() as { id: string; title: string }[];
    const omelet = recipes.find((r) => r.title === 'Омлет с сыром')!;
    replies.push(JSON.stringify({ days: [{ day: 'Понедельник', meals: [{ recipe_id: omelet.id, meal: 'завтрак' }, { recipe_id: 'выдумка', meal: 'ужин' }] }] }));
    const r = (await call(ai, d, 'me', 'POST', ['menu'], { days: 1 })) as { plan: { meals: unknown[] }[]; missing: string[] };
    expect(r.plan[0].meals).toEqual([{ recipe_id: omelet.id, meal: 'завтрак' }]);
    expect(r.missing.length).toBeGreaterThan(0);
  });

  it('фото — только картинка разумного размера', async () => {
    const d = setup();
    await expect(call(ai, d, 'me', 'POST', ['pantry-photo'], { image: 'data:text/html;base64,AAAA' })).rejects.toThrow(/фотография/);
    replies.push('{"products":["Молоко","яйца"]}');
    const r = (await call(ai, d, 'me', 'POST', ['pantry-photo'], { image: 'data:image/jpeg;base64,/9j/AAAA' })) as { products: string[] };
    expect(r.products).toEqual(['молоко', 'яйца']);
  });
});

describe('поддержка', () => {
  it('автор видит свои, админ — все и отвечает; не админ ответить не может', async () => {
    const d = setup();
    const { id } = (await call(support, d, 'me', 'POST', [], { kind: 'bug', text: 'Не грузится погода', page: '/task' })) as { id: string };
    const mine = (await call(support, d, 'me', 'GET', [])) as { admin: boolean; inbox: unknown };
    expect(mine.admin).toBe(false);
    expect(mine.inbox).toBeNull();
    await expect(call(support, d, 'me', 'PATCH', [id], { status: 'done' })).rejects.toThrow(/только поддержка/);
    const boss = (await call(support, d, 'boss', 'GET', [])) as { admin: boolean; inbox: { id: string }[] };
    expect(boss.admin).toBe(true);
    expect(boss.inbox.map((x) => x.id)).toEqual([id]);
    await call(support, d, 'boss', 'PATCH', [id], { status: 'done', reply: 'Починили' });
    const after = (await call(support, d, 'me', 'GET', [])) as { mine: { status: string; reply: string }[] };
    expect(after.mine[0]).toMatchObject({ status: 'done', reply: 'Починили' });
  });
});
