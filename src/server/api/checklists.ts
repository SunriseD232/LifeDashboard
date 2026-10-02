import { randomUUID } from 'node:crypto';
import { findChecklist } from '../checklistStore';
import { householdOf } from '../household';
import { HttpError, text, type Ctx } from '../http';

const ICONS = new Set(['bag', 'wave', 'house', 'list']);

/**
 * Чек-листы: /api/checklists[/:id[/действие]]. Свои и общие для семьи
 * (shared в теле PATCH); удалить общий или сделать личным может только автор.
 */
export function checklists({ d, userId, method, body, id, action }: Ctx): unknown {
  if (method === 'POST' && !id) {
    const title = text(body.title, 80, 'Название')!;
    const icon = ICONS.has(body.icon) ? body.icon : 'bag';
    const cid = randomUUID();
    const pos =
      ((d.prepare('select max(position) as m from checklists where user_id = ?').get(userId) as { m: number | null })
        .m ?? -1) + 1;
    const insertItem = d.prepare(
      'insert into checklist_items (id, checklist_id, user_id, title, group_name, position) values (?, ?, ?, ?, ?, ?)',
    );
    d.transaction(() => {
      d.prepare('insert into checklists (id, user_id, title, icon, position) values (?, ?, ?, ?, ?)').run(
        cid,
        userId,
        title,
        icon,
        pos,
      );
      const seed: unknown[] = Array.isArray(body.items) ? body.items.slice(0, 100) : [];
      seed.forEach((raw, i) => {
        const it = raw as { title?: unknown; group_name?: unknown };
        insertItem.run(randomUUID(), cid, userId, text(it.title, 120, 'Вещь')!, text(it.group_name, 60, 'Группа', true), i);
      });
    })();
    return { id: cid };
  }

  const list = findChecklist(d, userId, id);
  if (!list) throw new HttpError(404, 'Чек-лист не найден.');
  const mine = list.user_id === userId;

  if (method === 'PATCH' && !action) {
    if (body.title !== undefined) {
      d.prepare('update checklists set title = ? where id = ?').run(text(body.title, 80, 'Название'), list.id);
    }
    if (body.icon !== undefined && ICONS.has(body.icon)) {
      d.prepare('update checklists set icon = ? where id = ?').run(body.icon, list.id);
    }
    if (body.shared !== undefined) {
      if (!body.shared && list.household_id && !mine) throw new HttpError(403, 'Сделать личным может только автор.');
      const hh = body.shared ? householdOf(d, userId) : null;
      if (body.shared && !hh) throw new HttpError(400, 'Чтобы делиться, создайте семью в настройках.');
      d.prepare('update checklists set household_id = ? where id = ?').run(hh, list.id);
    }
    return { ok: true };
  }
  if (method === 'DELETE' && !action) {
    if (list.household_id && !mine) throw new HttpError(403, 'Удалить общий чек-лист может только автор.');
    d.prepare('delete from checklists where id = ?').run(list.id);
    return { ok: true };
  }
  if (method === 'POST' && action === 'reset') {
    d.prepare('update checklist_items set done = 0 where checklist_id = ?').run(list.id);
    return { ok: true };
  }
  if (method === 'POST' && action === 'items') {
    const iid = randomUUID();
    const pos =
      ((d.prepare('select max(position) as m from checklist_items where checklist_id = ?').get(list.id) as {
        m: number | null;
      }).m ?? -1) + 1;
    d.prepare(
      'insert into checklist_items (id, checklist_id, user_id, title, group_name, position) values (?, ?, ?, ?, ?, ?)',
    ).run(iid, list.id, userId, text(body.title, 120, 'Вещь'), text(body.group_name, 60, 'Группа', true), pos);
    return { id: iid, position: pos };
  }
  if (method === 'POST' && action === 'reorder') {
    const ids: unknown[] = Array.isArray(body.ids) ? body.ids : [];
    const upd = d.prepare('update checklist_items set position = ? where id = ? and checklist_id = ?');
    d.transaction(() => ids.forEach((iid, i) => upd.run(i, String(iid), list.id)))();
    return { ok: true };
  }
  if (method === 'POST' && action === 'rename-group') {
    const to = text(body.to, 60, 'Группа', true);
    const from = body.from === null ? null : text(body.from, 60, 'Группа');
    if (from === null) {
      d.prepare('update checklist_items set group_name = ? where checklist_id = ? and group_name is null').run(to, list.id);
    } else {
      d.prepare('update checklist_items set group_name = ? where checklist_id = ? and group_name = ?').run(
        to,
        list.id,
        from,
      );
    }
    return { ok: true };
  }
  if (method === 'POST' && action === 'delete-group') {
    const from = body.from === null ? null : text(body.from, 60, 'Группа');
    if (from === null) d.prepare('delete from checklist_items where checklist_id = ? and group_name is null').run(list.id);
    else d.prepare('delete from checklist_items where checklist_id = ? and group_name = ?').run(list.id, from);
    return { ok: true };
  }
  return undefined;
}
