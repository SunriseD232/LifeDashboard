/**
 * Быстрый поиск (Ctrl K) — общее для сервера и экрана: как превратить ввод в
 * запрос к полнотекстовому индексу и как показать найденный кусок текста.
 */

export type SearchKind = 'task' | 'note' | 'checklist' | 'item' | 'reminder' | 'recipe' | 'vacation' | 'workout' | 'op' | 'account' | 'debt' | 'goal';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** Кусок текста с совпадением; совпадения — между MARK_START и MARK_END. */
  snippet: string;
  /** Для пункта чек-листа — его чек-лист. */
  parent?: { id: string; title: string };
  /** Для операции «Денег» — её месяц: открываем его. */
  month?: string;
}

/** Слова текста: нижний регистр, «ё» = «е», без знаков. */
function split(text: string): string[] {
  return normalize(text)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Слова ввода — не больше восьми. */
export function words(input: string): string[] {
  return split(input).slice(0, 8);
}

/**
 * То же правило, что у индекса, но без него — для разделов вне FTS
 * (отпуска, «Деньги», быстрые действия): каждое слово запроса — начало
 * какого-то слова текста.
 */
export function matches(text: string, query: string[] | string): boolean {
  const q = typeof query === 'string' ? words(query) : query;
  if (!q.length) return false;
  const t = split(text);
  return q.every((w) => t.some((x) => x.startsWith(w)));
}

export const MARK_START = '\u0001';
export const MARK_END = '\u0002';

/** «ё» → «е»: так же лежит текст в индексе (миграция 5). */
export function normalize(s: string): string {
  return s.replace(/ё/g, 'е').replace(/Ё/g, 'Е');
}

/**
 * Ввод → запрос FTS5: каждое слово ищется по началу («бассейн» найдёт
 * «бассейна»), все слова — обязательны. Служебные символы FTS5 выкидываем:
 * пользователь пишет текст, а не язык запросов. Пусто — null.
 */
export function toMatch(input: string): string | null {
  const w = words(input);
  if (!w.length) return null;
  return w.map((x) => `"${x}"*`).join(' ');
}

/** Кусок текста → части для показа: { text, hit } — без HTML, без риска вставить разметку. */
export function splitSnippet(s: string): { text: string; hit: boolean }[] {
  const out: { text: string; hit: boolean }[] = [];
  let hit = false;
  let buf = '';
  for (const ch of s) {
    if (ch === MARK_START || ch === MARK_END) {
      if (buf) out.push({ text: buf, hit });
      buf = '';
      hit = ch === MARK_START;
    } else buf += ch;
  }
  if (buf) out.push({ text: buf, hit });
  return out;
}
