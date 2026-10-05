import { findItem } from '../checklistStore';
import { HttpError, text, type Ctx } from '../http';
import { addToPantry, productByName, scopeOfList } from '../kitchenStore';

/**
 * Пункты чек-листа: /api/items/:id. Пункт виден, если виден его чек-лист.
 * Купили продукт в списке покупок — он попадает в «что есть дома». Пункт без
 * продукта (добавлен через «Чек-листы») привязываем к продукту по названию.
 */
export function items({ d, userId, method, body, id }: Ctx): unknown {
  if (!id) return undefined;
  const it = findItem(d, userId, id);
  if (!it) throw new HttpError(404, 'Пункт не найден.');
  if (method === 'PATCH') {
    d.transaction(() => {
      if (body.title !== undefined) d.prepare('update checklist_items set title = ? where id = ?').run(text(body.title, 120, 'Вещь'), id);
      if (body.done !== undefined) {
        d.prepare('update checklist_items set done = ? where id = ?').run(body.done ? 1 : 0, id);
        if (body.done && !it.done && it.checklist.kind === 'shopping') {
          let pid = it.product_id;
          if (!pid) {
            pid = productByName(d, userId, it.title).id;
            d.prepare('update checklist_items set product_id = ? where id = ?').run(pid, id);
          }
          addToPantry(d, scopeOfList(it.checklist), pid);
        }
      }
      if (body.note !== undefined) d.prepare('update checklist_items set note = ? where id = ?').run(text(body.note, 120, 'Заметка', true), id);
      if (body.group_name !== undefined) {
        d.prepare('update checklist_items set group_name = ? where id = ?').run(text(body.group_name, 60, 'Группа', true), id);
      }
    })();
    return { ok: true };
  }
  if (method === 'DELETE') {
    d.prepare('delete from checklist_items where id = ?').run(id);
    return { ok: true };
  }
  return undefined;
}
