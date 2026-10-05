import Database from 'better-sqlite3';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { migrate } from '@/lib/migrations';

vi.mock('@/lib/auth', () => ({ userLogin: (id: string) => id }));
vi.mock('../mail', () => ({ sendMail: async () => undefined }));
const { support } = await import('../api/support');
import type { Ctx } from '../http';

function setup() {
  const d = new Database(':memory:');
  migrate(d);
  const add = d.prepare("insert into users (id, login, password_hash) values (?, ?, 'x')");
  ['me', 'other', 'boss'].forEach((u) => add.run(u, u));
  return d;
}
const call = (d: Database.Database, userId: string, method: string, body: Record<string, unknown> = {}, id?: string) =>
  support({ d, userId, method, body, id } as unknown as Ctx) as Promise<{ id: string }>;

afterEach(() => {
  delete process.env.ADMIN_LOGINS;
});

describe('удаление обращений', () => {
  it('автор — своё, чужое — нет, админ — любое', async () => {
    process.env.ADMIN_LOGINS = 'boss';
    const d = setup();
    const { id: a } = await call(d, 'me', 'POST', { kind: 'idea', text: 'Сделайте тёмную тему' });
    const { id: b } = await call(d, 'me', 'POST', { kind: 'bug', text: 'Не открывается' });
    await expect(call(d, 'other', 'DELETE', {}, a)).rejects.toThrow('не найдено');
    await call(d, 'me', 'DELETE', {}, a);
    await call(d, 'boss', 'DELETE', {}, b);
    expect((d.prepare('select count(*) n from feedback').get() as { n: number }).n).toBe(0);
  });
});
