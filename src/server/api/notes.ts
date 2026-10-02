import { randomUUID } from 'node:crypto';
import { householdOf } from '../household';
import { HttpError, text, type Ctx } from '../http';
import { findNote } from '../noteStore';

const MAX_BODY = 50_000;
const MAX_TAGS = 10;

function body(v: unknown): string {
  if (v === undefined || v === null) return '';
  if (typeof v !== 'string') throw new HttpError(400, 'Текст заметки — строкой.');
  if (v.length > MAX_BODY) throw new HttpError(400, 'Заметка слишком длинная.');
  return v;
}

function tags(v: unknown): string[] {
  if (!Array.isArray(v)) throw new HttpError(400, 'Метки — списком.');
  const out = [...new Set(v.map((t) => (typeof t === 'string' ? t.trim().toLowerCase() : '')).filter(Boolean))];
  if (out.length > MAX_TAGS || out.some((t) => t.length > 30)) throw new HttpError(400, `До ${MAX_TAGS} меток, каждая — до 30 символов.`);
  return out;
}

/**
 * Заметки: /api/notes[/:id].
 * Тело: { title, body, tags: [], pinned, shared (общая для семьи), checklist_id }.
 * Экран сохраняет на ходу — PATCH приходит часто и только с изменённым.
 */
export function notes({ d, userId, method, body: b, id }: Ctx): unknown {
  const checklistId = (v: unknown) => {
    const cid = typeof v === 'string' ? v : null;
    return cid && d.prepare('select 1 from checklists where id = ? and user_id = ?').get(cid, userId) ? cid : null;
  };
  const sharedTo = (v: unknown): string | null => {
    if (!v) return null;
    const hh = householdOf(d, userId);
    if (!hh) throw new HttpError(400, 'Чтобы делиться заметками, создайте семью в настройках.');
    return hh;
  };

  if (method === 'POST' && !id) {
    const nid = randomUUID();
    d.prepare(
      'insert into notes (id, user_id, household_id, title, body, tags, pinned, checklist_id) values (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(
      nid,
      userId,
      sharedTo(b.shared),
      text(b.title, 200, 'Заголовок', true) ?? '',
      body(b.body),
      JSON.stringify(b.tags === undefined ? [] : tags(b.tags)),
      b.pinned ? 1 : 0,
      checklistId(b.checklist_id),
    );
    return { id: nid };
  }

  const n = findNote(d, userId, id);
  if (!n) throw new HttpError(404, 'Заметка не найдена.');

  if (method === 'PATCH') {
    d.transaction(() => {
      const set = (col: string, v: unknown) => d.prepare(`update notes set ${col} = ? where id = ?`).run(v, n.id);
      if (b.title !== undefined) set('title', text(b.title, 200, 'Заголовок', true) ?? '');
      if (b.body !== undefined) set('body', body(b.body));
      if (b.tags !== undefined) set('tags', JSON.stringify(tags(b.tags)));
      if (b.pinned !== undefined) set('pinned', b.pinned ? 1 : 0);
      if (b.checklist_id !== undefined) set('checklist_id', checklistId(b.checklist_id));
      if (b.shared !== undefined) {
        if (!b.shared && n.household_id && n.user_id !== userId) throw new HttpError(403, 'Сделать личной может только автор.');
        set('household_id', sharedTo(b.shared));
      }
      d.prepare("update notes set updated_at = datetime('now') where id = ?").run(n.id);
    })();
    return { ok: true };
  }

  if (method === 'DELETE') {
    if (n.household_id && n.user_id !== userId) throw new HttpError(403, 'Удалить общую заметку может только автор.');
    d.prepare('delete from notes where id = ?').run(n.id);
    return { ok: true };
  }

  return undefined;
}
