import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '@/lib/migrations';
import { tourFor } from '@/lib/tour';
import { settings } from '../api/settings';
import type { Ctx } from '../http';
import { readSettings } from '../settings';

function setup() {
  const d = new Database(':memory:');
  migrate(d);
  d.prepare("insert into users (id, login, password_hash) values ('me', 'me', 'x')").run();
  return d;
}
const patch = (d: Database.Database, body: Record<string, unknown>) => settings({ d, userId: 'me', method: 'PATCH', body } as unknown as Ctx);

describe('подсказки и поля окна задачи', () => {
  it('по умолчанию пусто; сохраняются без мусора', () => {
    const d = setup();
    expect(readSettings(d, 'me')).toMatchObject({ tour_seen: [], task_hidden: [] });
    patch(d, { tour_seen: ['home', 'tasks', 'home', 5], task_hidden: ['tags', 'evil', 'note'] });
    expect(readSettings(d, 'me')).toMatchObject({ tour_seen: ['home', 'tasks'], task_hidden: ['tags', 'note'] });
    // Другие настройки не трогают списки.
    patch(d, { deadline_time: '08:00' });
    expect(readSettings(d, 'me')).toMatchObject({ deadline_time: '08:00', tour_seen: ['home', 'tasks'] });
  });
  it('раздел по адресу — только главные экраны', () => {
    expect(tourFor('/')?.id).toBe('home');
    expect(tourFor('/tasks')?.id).toBe('tasks');
    expect(tourFor('/kitchen/new')).toBeNull();
    expect(tourFor('/settings')).toBeNull();
  });
});
