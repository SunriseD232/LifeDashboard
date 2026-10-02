/**
 * Быстрый поиск (Ctrl K) — общее для сервера и экрана: как превратить ввод в
 * запрос к полнотекстовому индексу и как показать найденный кусок текста.
 */

export type SearchKind = 'task' | 'note' | 'checklist' | 'item' | 'reminder' | 'recipe';

export interface SearchHit {
  kind: SearchKind;
  id: string;
  title: string;
  /** Кусок текста с совпадением; совпадения — между MARK_START и MARK_END. */
  snippet: string;
  /** Для пункта чек-листа — его чек-лист. */
  parent?: { id: string; title: string };
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
  const words = normalize(input)
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  if (!words.length) return null;
  return words.map((w) => `"${w}"*`).join(' ');
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
