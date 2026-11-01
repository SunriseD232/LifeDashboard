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
  it('главная: настройки и счётчики действий', async () => {
    const d = setup();
    expect(readSettings(d, 'me')).toMatchObject({ hub: { bar: null, tiles: null, auto: true, pins: [] }, hub_usage: {} });
    patch(d, { hub: { bar: ['money', 'home', 'tasks', 'settings'], tiles: [{ id: 'spend', size: 'w' }, { id: 'evil' }], pins: ['op'] } });
    expect(readSettings(d, 'me').hub).toEqual({ bar: ['money', 'home', 'tasks', 'settings'], tiles: [{ id: 'spend', size: 'w', hidden: false }], auto: true, pins: ['op'], off: [], noMoney: false });
    // Другие настройки главную не трогают; null — как было.
    patch(d, { deadline_time: '10:00' });
    expect(readSettings(d, 'me').hub.pins).toEqual(['op']);
    patch(d, { hub: null });
    expect(readSettings(d, 'me').hub.bar).toBeNull();

    const { hub } = await import('../api/hub');
    const use = (body: Record<string, unknown>) => hub({ d, userId: 'me', method: 'POST', id: 'use', body } as unknown as Ctx);
    await use({ id: 'gym', hour: 8 });
    await use({ id: 'gym', hour: 20 });
    expect(readSettings(d, 'me').hub_usage).toEqual({ gym: [0, 1, 0, 1] });
    await expect(use({ id: 'hack', hour: 8 })).rejects.toMatchObject({ status: 400 });
    await expect(use({ id: 'gym', hour: 24 })).rejects.toMatchObject({ status: 400 });
  });
  it('раздел по адресу — только главные экраны', () => {
    // На главной супер-аппа подсказок нет.
    expect(tourFor('/')?.id).toBe('hub');
    expect(tourFor('/tasks')?.id).toBe('tasks');
    expect(tourFor('/kitchen/new')).toBeNull();
    expect(tourFor('/settings')).toBeNull();
  });
});
