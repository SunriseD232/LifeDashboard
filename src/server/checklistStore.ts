import type Database from 'better-sqlite3';
import type { Checklist, ChecklistItem } from '@/lib/types';
import { visibleWhere } from './household';

/**
 * Чек-листы и пункты из базы: свои и общие для семьи. Пункт виден, если
 * виден его чек-лист.
 */

export function readChecklists(d: Database.Database, userId: string): Checklist[] {
  const v = visibleWhere(d, userId, 'c');
  return (
    d
      .prepare(
        `select c.id, c.title, c.icon, c.position, c.household_id, c.kind, c.user_id, u.login as author
         from checklists c left join users u on u.id = c.user_id
         where ${v.where} order by c.position, c.created_at`,
      )
      .all(...v.params) as (Checklist & { user_id: string })[]
  ).map(({ user_id, ...c }) => ({ ...c, author: user_id === userId ? null : c.author }));
}

export function readItems(d: Database.Database, userId: string): ChecklistItem[] {
  const v = visibleWhere(d, userId, 'c');
  return (
    d
      .prepare(
        `select i.id, i.checklist_id, i.title, i.group_name, i.note, i.done, i.position, i.product_id, i.qty, i.unit, i.recipe_title
         from checklist_items i join checklists c on c.id = i.checklist_id
         where ${v.where} order by i.position, i.created_at`,
      )
      .all(...v.params) as Record<string, unknown>[]
  ).map((r) => ({ ...(r as unknown as ChecklistItem), done: !!r.done }));
}

export interface ChecklistRow {
  id: string;
  user_id: string;
  household_id: string | null;
  kind: string;
}

export function findChecklist(d: Database.Database, userId: string, id: unknown): ChecklistRow | null {
  if (typeof id !== 'string' || !id) return null;
  const v = visibleWhere(d, userId, 'c');
  return (d.prepare(`select c.id, c.user_id, c.household_id, c.kind from checklists c where c.id = ? and ${v.where}`).get(id, ...v.params) as
    | ChecklistRow
    | undefined) ?? null;
}

export function findItem(
  d: Database.Database,
  userId: string,
  id: unknown,
): { id: string; title: string; product_id: string | null; done: number; checklist: ChecklistRow } | null {
  if (typeof id !== 'string' || !id) return null;
  const v = visibleWhere(d, userId, 'c');
  const r = d
    .prepare(
      `select i.id, i.title, i.product_id, i.done, c.id as cid, c.user_id, c.household_id, c.kind
       from checklist_items i join checklists c on c.id = i.checklist_id where i.id = ? and ${v.where}`,
    )
    .get(id, ...v.params) as
    | { id: string; title: string; product_id: string | null; done: number; cid: string; user_id: string; household_id: string | null; kind: string }
    | undefined;
  if (!r) return null;
  return { id: r.id, title: r.title, product_id: r.product_id, done: r.done, checklist: { id: r.cid, user_id: r.user_id, household_id: r.household_id, kind: r.kind } };
}
