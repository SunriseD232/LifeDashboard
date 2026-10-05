import type Database from 'better-sqlite3';
import { cleanTags, isPriority } from '@/lib/tasks';
import type { Priority } from '@/lib/types';
import { HttpError } from './http';

/**
 * Свои метки человека (user_tags): из них выбирают в форме задачи и в
 * фильтре. Новая метка у задачи сама попадает в список.
 */

export function readTags(d: Database.Database, userId: string): string[] {
  return (d.prepare('select name from user_tags where user_id = ? order by position, name').all(userId) as { name: string }[]).map((r) => r.name);
}

/** Метки из тела запроса → JSON для базы; незнакомые — в свой список. */
export function tagsFor(d: Database.Database, userId: string, v: unknown): string {
  const tags = cleanTags(v);
  const have = new Map(readTags(d, userId).map((t) => [t.toLowerCase(), t]));
  const pos = (d.prepare('select coalesce(max(position), -1) + 1 as p from user_tags where user_id = ?').get(userId) as { p: number }).p;
  const add = d.prepare('insert or ignore into user_tags (user_id, name, position) values (?, ?, ?)');
  // Регистр — как в своём списке: «Работа» и «работа» — одна метка.
  const out = tags.map((t, i) => {
    const known = have.get(t.toLowerCase());
    if (known) return known;
    add.run(userId, t, pos + i);
    return t;
  });
  return JSON.stringify(out);
}

export function priority(v: unknown): Priority {
  if (v === undefined || v === null) return 0;
  if (!isPriority(v)) throw new HttpError(400, 'Важность — от 0 до 3.');
  return v;
}

const sameName = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Переименовать метку у себя и во всех своих задачах; to — существующая — слить. */
export function renameTag(d: Database.Database, userId: string, from: string, to: string): void {
  const fix = (table: 'tasks' | 'reminders') => {
    const rows = d.prepare(`select id, tags from ${table} where user_id = ? and tags <> '[]'`).all(userId) as { id: string; tags: string }[];
    const set = d.prepare(`update ${table} set tags = ? where id = ?`);
    for (const r of rows) {
      const tags = JSON.parse(r.tags) as string[];
      if (!tags.some((t) => sameName(t, from))) continue;
      set.run(JSON.stringify(cleanTags(tags.map((t) => (sameName(t, from) ? to : t)))), r.id);
    }
  };
  d.transaction(() => {
    const own = readTags(d, userId);
    const pos = (d.prepare('select position from user_tags where user_id = ? and name = ?').get(userId, own.find((t) => sameName(t, from)) ?? from) as
      | { position: number }
      | undefined)?.position ?? 0;
    for (const t of own.filter((t) => sameName(t, from))) d.prepare('delete from user_tags where user_id = ? and name = ?').run(userId, t);
    if (!own.some((t) => sameName(t, to) && !sameName(t, from))) d.prepare('insert or ignore into user_tags (user_id, name, position) values (?, ?, ?)').run(userId, to, pos);
    fix('tasks');
    fix('reminders');
  })();
}

/** Удалить метку из списка и из всех своих задач. */
export function deleteTag(d: Database.Database, userId: string, name: string): void {
  d.transaction(() => {
    for (const t of readTags(d, userId).filter((t) => sameName(t, name))) d.prepare('delete from user_tags where user_id = ? and name = ?').run(userId, t);
    for (const table of ['tasks', 'reminders'] as const) {
      const rows = d.prepare(`select id, tags from ${table} where user_id = ? and tags <> '[]'`).all(userId) as { id: string; tags: string }[];
      for (const r of rows) {
        const tags = JSON.parse(r.tags) as string[];
        if (tags.some((t) => sameName(t, name))) d.prepare(`update ${table} set tags = ? where id = ?`).run(JSON.stringify(tags.filter((t) => !sameName(t, name))), r.id);
      }
    }
  })();
}
