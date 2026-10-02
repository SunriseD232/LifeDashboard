import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '@/lib/migrations';
import { findTask, readTasks } from '../taskStore';

function setup() {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  migrate(d);
  const user = d.prepare("insert into users (id, login, password_hash) values (?, ?, 'x')");
  ['me', 'wife', 'stranger'].forEach((u) => user.run(u, u));
  d.prepare("insert into households (id, name, created_by) values ('h', 'Семья', 'me')").run();
  d.prepare("insert into household_members (user_id, household_id) values ('me', 'h'), ('wife', 'h')").run();
  const task = d.prepare('insert into tasks (id, user_id, household_id, title) values (?, ?, ?, ?)');
  task.run('mine', 'me', null, 'Моё');
  task.run('shared', 'me', 'h', 'Общее');
  task.run('hers', 'wife', null, 'Её личное');
  task.run('alien', 'stranger', null, 'Чужое');
  return d;
}

describe('видимость дел', () => {
  it('я вижу свои и общие, не вижу личные других', () => {
    const d = setup();
    expect(readTasks(d, 'me', '2026-10-02').tasks.map((t) => t.id).sort()).toEqual(['mine', 'shared']);
    expect(findTask(d, 'me', 'hers')).toBeNull();
    expect(findTask(d, 'me', 'alien')).toBeNull();
  });
  it('участник семьи видит общее с автором', () => {
    const d = setup();
    const t = readTasks(d, 'wife', '2026-10-02').tasks;
    expect(t.map((x) => [x.id, x.author]).sort()).toEqual([
      ['hers', null],
      ['shared', 'me'],
    ]);
  });
  it('посторонний общего не видит', () => {
    const d = setup();
    expect(findTask(d, 'stranger', 'shared')).toBeNull();
  });
  it('семья удалена — общее дело остаётся личным у автора', () => {
    const d = setup();
    d.prepare("delete from households where id = 'h'").run();
    expect(findTask(d, 'me', 'shared')?.household_id).toBeNull();
    expect(findTask(d, 'wife', 'shared')).toBeNull();
  });
});
