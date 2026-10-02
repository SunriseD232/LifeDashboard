import { own, text, type Ctx } from '../http';

/** Пункты чек-листа: /api/items/:id. */
export function items({ d, userId, method, body, id }: Ctx): unknown {
  if (id) {
    own(d.prepare('select id from checklist_items where id = ? and user_id = ?').get(id, userId), 'Пункт');
    if (method === 'PATCH') {
      if (body.title !== undefined) d.prepare('update checklist_items set title = ? where id = ?').run(text(body.title, 120, 'Вещь'), id);
      if (body.done !== undefined) d.prepare('update checklist_items set done = ? where id = ?').run(body.done ? 1 : 0, id);
      if (body.note !== undefined) d.prepare('update checklist_items set note = ? where id = ?').run(text(body.note, 120, 'Заметка', true), id);
      if (body.group_name !== undefined) {
        d.prepare('update checklist_items set group_name = ? where id = ?').run(text(body.group_name, 60, 'Группа', true), id);
      }
      return { ok: true };
    }
    if (method === 'DELETE') {
      d.prepare('delete from checklist_items where id = ?').run(id);
      return { ok: true };
    }
  }
  return undefined;
}
