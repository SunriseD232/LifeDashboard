import { HttpError, text, type Ctx } from '../http';
import { deleteTag, readTags, renameTag, tagsFor } from '../tagStore';

/**
 * Свои метки: /api/tags — GET список; POST { name } — добавить;
 * POST /tags/rename { from, to }; POST /tags/delete { name } (уберёт и из задач).
 */
export function tags({ d, userId, method, body, id }: Ctx): unknown {
  if (method === 'GET' && !id) return { tags: readTags(d, userId) };
  if (method !== 'POST') return undefined;
  if (!id) {
    tagsFor(d, userId, [text(body.name, 30, 'Метка')]);
    return { tags: readTags(d, userId) };
  }
  if (id === 'rename') {
    const from = text(body.from, 30, 'Метка')!;
    const to = text(body.to, 30, 'Новое название')!;
    if (!readTags(d, userId).some((t) => t.toLowerCase() === from.toLowerCase())) throw new HttpError(404, 'Метка не найдена.');
    renameTag(d, userId, from, to);
    return { tags: readTags(d, userId) };
  }
  if (id === 'delete') {
    deleteTag(d, userId, text(body.name, 30, 'Метка')!);
    return { tags: readTags(d, userId) };
  }
  return undefined;
}
