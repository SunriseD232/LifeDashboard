import type Database from 'better-sqlite3';
import type { Note } from '@/lib/types';
import { visibleWhere } from './household';

interface Row extends Omit<Note, 'tags' | 'pinned' | 'author'> {
  user_id: string;
  tags: string;
  pinned: number;
  author: string | null;
}

const SELECT = `select n.id, n.user_id, n.household_id, n.title, n.body, n.tags, n.pinned, n.checklist_id, n.updated_at,
  u.login as author from notes n left join users u on u.id = n.user_id`;

function toNote(r: Row, userId: string): Note {
  return {
    id: r.id,
    title: r.title,
    body: r.body,
    tags: JSON.parse(r.tags) as string[],
    pinned: !!r.pinned,
    household_id: r.household_id,
    checklist_id: r.checklist_id,
    author: r.user_id === userId ? null : r.author,
    updated_at: r.updated_at,
  };
}

/** Свои и общие заметки: закреплённые первыми, дальше свежие. */
export function readNotes(d: Database.Database, userId: string): Note[] {
  const v = visibleWhere(d, userId, 'n');
  return (d.prepare(`${SELECT} where ${v.where} order by n.pinned desc, n.updated_at desc`).all(...v.params) as Row[]).map((r) =>
    toNote(r, userId),
  );
}

export function findNote(d: Database.Database, userId: string, id: string | undefined): (Note & { user_id: string }) | null {
  if (!id) return null;
  const v = visibleWhere(d, userId, 'n');
  const r = d.prepare(`${SELECT} where n.id = ? and ${v.where}`).get(id, ...v.params) as Row | undefined;
  return r ? { ...toNote(r, userId), user_id: r.user_id } : null;
}
