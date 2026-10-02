import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { LATEST, MIGRATIONS, migrate, schemaVersion } from '../migrations';

const tables = (db: Database.Database) =>
  (db.prepare("select name from sqlite_master where type = 'table' order by name").all() as { name: string }[]).map(
    (r) => r.name,
  );

describe('migrate', () => {
  it('доводит новую базу до последней версии', () => {
    const db = new Database(':memory:');
    expect(migrate(db)).toBe(MIGRATIONS.length);
    expect(schemaVersion(db)).toBe(LATEST);
    expect(tables(db)).toEqual(expect.arrayContaining(['users', 'sessions', 'checklists', 'reminders', 'push_subscriptions']));
  });

  it('второй прогон ничего не делает и не зовёт снимок', () => {
    const db = new Database(':memory:');
    migrate(db);
    let called = false;
    expect(migrate(db, () => (called = true))).toBe(0);
    expect(called).toBe(false);
  });

  it('принимает базу «до миграций» с данными и не теряет их', () => {
    const db = new Database(':memory:');
    db.exec("create table checklists (id text primary key, user_id text not null, title text not null, icon text not null default 'bag', position integer not null default 0, created_at text not null default (datetime('now')))");
    db.prepare("insert into checklists (id, user_id, title) values ('c1', 'u1', 'Бассейн')").run();
    let from = -1;
    migrate(db, (v) => (from = v));
    expect(from).toBe(0);
    expect(db.prepare('select title from checklists').get()).toEqual({ title: 'Бассейн' });
  });

  it('номера версий идут подряд с 1', () => {
    MIGRATIONS.forEach((m, i) => expect(m.version).toBe(i + 1));
  });
});
