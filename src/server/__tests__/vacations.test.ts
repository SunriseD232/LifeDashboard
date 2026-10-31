import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '@/lib/migrations';
import { vacations } from '../api/vacations';
import type { Ctx } from '../http';
import { readSettings } from '../settings';

function setup() {
  const d = new Database(':memory:');
  migrate(d);
  d.prepare("insert into users (id, login, password_hash) values ('me', 'me', 'x'), ('other', 'other', 'x')").run();
  return d;
}
const call = (d: Database.Database, method: string, body: Record<string, unknown> = {}, id?: string, userId = 'me') =>
  vacations({ d, userId, method, body, id } as unknown as Ctx) as { id?: string; list: { id: string; title: string; start: string; end: string; pause: boolean }[]; allowance: number | null };

describe('отпуска', () => {
  it('добавить, изменить, удалить; чужие не видны', () => {
    const d = setup();
    const { id } = call(d, 'POST', { start: '2026-07-01', end: '2026-07-14' });
    expect(call(d, 'GET').list).toEqual([{ id, title: 'Отпуск', start: '2026-07-01', end: '2026-07-14', pause: true }]);
    call(d, 'PATCH', { title: 'Море', pause: false }, id);
    expect(call(d, 'GET').list[0]).toMatchObject({ title: 'Море', pause: false, end: '2026-07-14' });
    expect(call(d, 'GET', {}, undefined, 'other').list).toEqual([]);
    expect(() => call(d, 'DELETE', {}, id, 'other')).toThrow();
    call(d, 'DELETE', {}, id);
    expect(call(d, 'GET').list).toEqual([]);
  });

  it('проверяет даты и пересечения', () => {
    const d = setup();
    expect(() => call(d, 'POST', { start: '2026-07-10', end: '2026-07-01' })).toThrow(/раньше/);
    expect(() => call(d, 'POST', { start: 'вчера', end: '2026-07-01' })).toThrow(/дата/);
    const { id } = call(d, 'POST', { start: '2026-07-01', end: '2026-07-14' });
    expect(() => call(d, 'POST', { start: '2026-07-14', end: '2026-07-20' })).toThrow(/Пересекается/);
    // Свой же период можно сдвигать.
    call(d, 'PATCH', { start: '2026-07-03' }, id);
  });

  it('дни в году: сохраняются, не трогают остальные настройки', () => {
    const d = setup();
    expect(call(d, 'PUT', { days: 28 }, 'allowance').allowance).toBe(28);
    expect(readSettings(d, 'me').deadline_time).toBe('09:00');
    expect(call(d, 'PUT', { days: null }, 'allowance').allowance).toBeNull();
    expect(() => call(d, 'PUT', { days: 2.5 }, 'allowance')).toThrow();
  });
});
