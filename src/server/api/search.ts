import { MARK_END, MARK_START, toMatch, type SearchHit, type SearchKind } from '@/lib/search';
import { householdOf } from '../household';
import type { Ctx } from '../http';

const LIMIT = 60;

interface Row {
  kind: SearchKind;
  ref_id: string;
  title: string;
  snippet: string;
}

/**
 * Поиск по всему своему и общему: /api/search?q=. Индекс ведут триггеры
 * (миграция 5); здесь — запрос, видимость и названия чек-листов для пунктов.
 * Кусок текста — из «тела» (текст заметки, метка и заметка дела, группа
 * пункта): название и так показано строкой выше.
 */
export function search({ d, userId, method, id, req }: Ctx): unknown {
  if (method !== 'GET' || id) return undefined;
  const match = toMatch(req.nextUrl.searchParams.get('q') ?? '');
  if (!match) return { results: [] };
  const hh = householdOf(d, userId);
  const rows = d
    .prepare(
      `select kind, ref_id, title, snippet(search_fts, 1, ?, ?, '…', 10) as snippet
       from search_fts
       where search_fts match ? and (user_id = ? or (household_id is not null and household_id = ?))
       order by rank
       limit ?`,
    )
    .all(MARK_START, MARK_END, match, userId, hh, LIMIT) as Row[];

  // Пункту чек-листа нужен его чек-лист — чтобы открыть и подписать.
  const itemIds = rows.filter((r) => r.kind === 'item').map((r) => r.ref_id);
  const parents = new Map<string, { id: string; title: string }>();
  if (itemIds.length) {
    const found = d
      .prepare(
        `select i.id, c.id as cid, c.title from checklist_items i join checklists c on c.id = i.checklist_id
         where i.id in (select value from json_each(?))`,
      )
      .all(JSON.stringify(itemIds)) as { id: string; cid: string; title: string }[];
    for (const f of found) parents.set(f.id, { id: f.cid, title: f.title });
  }

  const results: SearchHit[] = rows.map((r) => ({
    kind: r.kind,
    id: r.ref_id,
    title: r.title,
    snippet: r.snippet,
    ...(r.kind === 'item' && parents.get(r.ref_id) ? { parent: parents.get(r.ref_id) } : {}),
  }));
  return { results };
}
