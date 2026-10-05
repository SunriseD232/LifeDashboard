import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate, MIGRATIONS } from '@/lib/migrations';
import { reminders } from '../api/reminders';
import { tags } from '../api/tags';
import { tasks } from '../api/tasks';
import type { Ctx } from '../http';
import { readReminders } from '../reminderStore';
import { readTags } from '../tagStore';
import { readTasks } from '../taskStore';

function setup() {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  migrate(d);
  d.prepare("insert into users (id, login, password_hash) values ('me', 'me', 'x')").run();
  return d;
}

const ctx = (d: Database.Database, method: string, body: Record<string, unknown>, id?: string) => ({ d, userId: 'me', method, body, id, action: undefined }) as unknown as Ctx;
const rule = { kind: 'once', date: '2026-10-05' };

describe('метки и важность', () => {
  it('у задачи с напоминанием: ставятся при создании и меняются потом', () => {
    const d = setup();
    const { id } = reminders(ctx(d, 'POST', { title: 'Созвон', times: ['15:00'], rule })) as { id: string };
    expect(readReminders(d, 'me')[0]).toMatchObject({ tags: [], priority: 0, note: null });
    reminders(ctx(d, 'PATCH', { tags: [' работа '], priority: 3, note: 'взять ноутбук' }, id));
    expect(readReminders(d, 'me')[0]).toMatchObject({ tags: ['работа'], priority: 3, note: 'взять ноутбук' });
    expect(() => reminders(ctx(d, 'PATCH', { priority: 7 }, id))).toThrow();
  });
  it('новая метка у задачи попадает в свой список; регистр — как в списке', () => {
    const d = setup();
    tasks(ctx(d, 'POST', { title: 'Мусор', tags: ['Дом'] }));
    tasks(ctx(d, 'POST', { title: 'Посуда', tags: ['дом', 'кухня'] }));
    expect(readTags(d, 'me')).toEqual(['Дом', 'кухня']);
    expect(readTasks(d, 'me', '2026-10-05').tasks.map((t) => t.tags)).toEqual([['Дом'], ['Дом', 'кухня']]);
  });
  it('переименовать и удалить метку — и у задач', () => {
    const d = setup();
    tasks(ctx(d, 'POST', { title: 'Мусор', tags: ['дом'] }));
    reminders(ctx(d, 'POST', { title: 'Цветы', times: ['10:00'], rule, tags: ['дом', 'дача'] }));
    tags(ctx(d, 'POST', { from: 'дом', to: 'Квартира' }, 'rename'));
    expect(readTags(d, 'me')).toEqual(['Квартира', 'дача']);
    expect(readReminders(d, 'me')[0].tags).toEqual(['Квартира', 'дача']);
    tags(ctx(d, 'POST', { name: 'квартира' }, 'delete'));
    expect(readTags(d, 'me')).toEqual(['дача']);
    expect(readTasks(d, 'me', '2026-10-05').tasks[0].tags).toEqual([]);
    expect(readReminders(d, 'me')[0].tags).toEqual(['дача']);
  });
});

describe('переход на два вида задач (миграция 13)', () => {
  it('дело со сроком становится напоминанием, общее — теряет срок, метка — в список', () => {
    const d = new Database(':memory:');
    d.pragma('foreign_keys = ON');
    // До v13 — старая схема с делами со сроком.
    d.pragma('foreign_keys = OFF');
    for (const m of MIGRATIONS.filter((x) => x.version <= 12)) m.up(d);
    d.pragma('user_version = 12');
    d.pragma('foreign_keys = ON');
    d.prepare("insert into users (id, login, password_hash) values ('me', 'me', 'x')").run();
    d.prepare("insert into households (id, name, created_by) values ('h', 'Семья', 'me')").run();
    d.prepare("insert into user_settings (user_id, deadline_time) values ('me', '08:30')").run();
    const add = d.prepare('insert into tasks (id, user_id, household_id, title, tag, due_date, rule, done_at) values (?, ?, ?, ?, ?, ?, ?, ?)');
    add.run('a', 'me', null, 'Паспорт', 'документы', '2026-10-08', null, null);
    add.run('b', 'me', null, 'Полить', null, '2026-10-06', JSON.stringify({ kind: 'after', unit: 'day', every: 3, start: '2026-09-01' }), null);
    add.run('c', 'me', 'h', 'Общее', null, '2026-10-07', null, null);
    add.run('e', 'me', null, 'Без срока', 'дом', null, null, null);
    migrate(d);
    const rems = readReminders(d, 'me');
    expect(rems.map((r) => [r.title, r.times, r.rule, r.tags])).toEqual([
      ['Паспорт', ['08:30'], { kind: 'once', date: '2026-10-08' }, ['документы']],
      ['Полить', ['08:30'], { kind: 'after', unit: 'day', every: 3, start: '2026-10-06' }, []],
    ]);
    const left = readTasks(d, 'me', '2026-10-05').tasks;
    expect(left.map((t) => [t.title, t.tags, t.household_id])).toEqual([
      ['Общее', [], 'h'],
      ['Без срока', ['дом'], null],
    ]);
    expect(readTags(d, 'me').sort()).toEqual(['документы', 'дом']);
  });
});
