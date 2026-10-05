import { CATEGORY_LABELS, type Category } from './kitchenSeed';
import { isDay, parseRule, RuleError, type Rule } from './recur';
import { cleanTags, isPriority } from './tasks';
import type { Priority } from './types';

/**
 * Разбор ответов ИИ. Модель может ошибиться или выдумать — поэтому всё, что
 * она вернула, проходит те же проверки, что ручной ввод: неверное
 * отбрасываем, а человек видит предложение и сам решает, что сохранить.
 */

/** Ответ модели → объект: без ```json-обёрток и лишнего текста вокруг. */
export function parseJsonLoose(text: string): unknown {
  const t = text.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '');
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf('{');
    const b = t.lastIndexOf('}');
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error('не JSON');
  }
}

const str = (v: unknown, max: number): string | null => {
  if (typeof v !== 'string') return null;
  const s = v.trim().replace(/\s+/g, ' ');
  return s ? s.slice(0, max) : null;
};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// ---------------------------------------------------------------- быстрый ввод фразой

export type QuickItem =
  | { type: 'task'; title: string; tags: string[]; priority: Priority }
  | { type: 'reminder'; title: string; times: string[]; rule: Rule; tags: string[]; priority: Priority }
  | { type: 'note'; title: string; body: string }
  | { type: 'shopping'; name: string; qty: number | null; unit: string | null };

/**
 * defaultTime — во сколько напоминать, если у задачи есть день, но нет
 * времени: задача с датой у нас всегда с напоминанием.
 */
export function parseQuickAdd(raw: unknown, defaultTime = '09:00'): QuickItem[] {
  const out: QuickItem[] = [];
  for (const x of arr((raw as { items?: unknown })?.items).slice(0, 20)) {
    const it = x as Record<string, unknown>;
    const tags = cleanTags(Array.isArray(it.tags) ? it.tags : typeof it.tag === 'string' ? [it.tag] : []);
    const priority: Priority = isPriority(it.priority) ? it.priority : 0;
    if (it.type === 'task') {
      const title = str(it.title, 200);
      if (!title) continue;
      if (isDay(it.due_date)) out.push({ type: 'reminder', title: title.slice(0, 120), times: [defaultTime], rule: { kind: 'once', date: it.due_date }, tags, priority });
      else out.push({ type: 'task', title, tags, priority });
    } else if (it.type === 'reminder') {
      const title = str(it.title, 120);
      const times = [...new Set(arr(it.times).filter((t): t is string => typeof t === 'string' && TIME_RE.test(t)))].sort().slice(0, 8);
      let rule: Rule | null = null;
      try {
        rule = parseRule(it.rule);
      } catch (e) {
        if (!(e instanceof RuleError)) throw e;
      }
      if (title && rule) out.push({ type: 'reminder', title, times: times.length ? (rule.kind === 'after' ? times.slice(0, 1) : times) : [defaultTime], rule, tags, priority });
    } else if (it.type === 'note') {
      const title = str(it.title, 200) ?? '';
      const body = typeof it.body === 'string' ? it.body.trim().slice(0, 5000) : '';
      if (title || body) out.push({ type: 'note', title, body });
    } else if (it.type === 'shopping') {
      const name = str(it.name, 60);
      const qty = typeof it.qty === 'number' && it.qty > 0 && it.qty < 100000 ? it.qty : null;
      if (name) out.push({ type: 'shopping', name: name.toLowerCase(), qty, unit: qty !== null ? str(it.unit, 10) : null });
    }
  }
  return out;
}

// ---------------------------------------------------------------- продукты с фото

export function parseProducts(raw: unknown): string[] {
  const names = arr((raw as { products?: unknown })?.products)
    .map((p) => str(typeof p === 'object' && p ? (p as { name?: unknown }).name : p, 60))
    .filter((p): p is string => !!p)
    .map((p) => p.toLowerCase());
  return [...new Set(names)].slice(0, 60);
}

// ---------------------------------------------------------------- рецепт

export interface RecipeDraft {
  title: string;
  category: Category;
  minutes: number | null;
  servings: number;
  ingredients: { name: string; qty: number | null; unit: string | null }[];
  steps: string[];
}

const UNITS = new Set(['г', 'кг', 'мл', 'л', 'шт.', 'ст. л.', 'ч. л.', 'стакан', 'зубчик', 'ломтик', 'банка', 'пучок', 'упак.']);

export function parseRecipe(raw: unknown): RecipeDraft | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const title = str(r.title, 120);
  if (!title) return null;
  const category = (Object.keys(CATEGORY_LABELS) as Category[]).includes(r.category as Category) ? (r.category as Category) : 'dinner';
  const minutes = typeof r.minutes === 'number' && r.minutes >= 1 && r.minutes <= 1440 ? Math.round(r.minutes) : null;
  const servings = typeof r.servings === 'number' && r.servings >= 1 && r.servings <= 50 ? Math.round(r.servings) : 2;
  const ingredients = arr(r.ingredients)
    .slice(0, 40)
    .map((x) => {
      const i = x as Record<string, unknown>;
      const name = str(i.name, 60);
      const qty = typeof i.qty === 'number' && i.qty > 0 && i.qty < 100000 ? i.qty : null;
      const unit = qty !== null && typeof i.unit === 'string' && UNITS.has(i.unit) ? i.unit : qty !== null ? 'шт.' : null;
      return name ? { name: name.toLowerCase(), qty, unit } : null;
    })
    .filter((x): x is NonNullable<typeof x> => !!x);
  const steps = arr(r.steps)
    .map((s) => (typeof s === 'string' ? s.trim().slice(0, 1000) : ''))
    .filter(Boolean)
    .slice(0, 30);
  return { title, category, minutes, servings, ingredients, steps };
}

// ---------------------------------------------------------------- меню на неделю

export interface MenuDay {
  day: string;
  meals: { recipe_id: string; meal: string }[];
}

/** Меню — только из рецептов, которые есть (выдуманные id отбрасываем). */
export function parseMenu(raw: unknown, recipeIds: ReadonlySet<string>): MenuDay[] {
  return arr((raw as { days?: unknown })?.days)
    .slice(0, 14)
    .map((x) => {
      const d = x as Record<string, unknown>;
      const day = str(d.day, 40);
      const meals = arr(d.meals)
        .map((m) => {
          const mm = m as Record<string, unknown>;
          const id = typeof mm.recipe_id === 'string' ? mm.recipe_id : null;
          return id && recipeIds.has(id) ? { recipe_id: id, meal: str(mm.meal, 20) ?? '' } : null;
        })
        .filter((m): m is NonNullable<typeof m> => !!m)
        .slice(0, 4);
      return day && meals.length ? { day, meals } : null;
    })
    .filter((d): d is MenuDay => !!d);
}

// ---------------------------------------------------------------- дела из заметки, чек-лист поездки

export function parseTasks(raw: unknown): { title: string; due_date: string | null }[] {
  return arr((raw as { tasks?: unknown })?.tasks)
    .map((x) => {
      const t = x as Record<string, unknown>;
      const title = str(t.title, 200);
      return title ? { title, due_date: isDay(t.due_date) ? t.due_date : null } : null;
    })
    .filter((t): t is NonNullable<typeof t> => !!t)
    .slice(0, 30);
}

export function parseChecklist(raw: unknown): { title: string; items: { title: string; group_name: string }[] } | null {
  const r = (raw ?? {}) as Record<string, unknown>;
  const title = str(r.title, 60);
  const items = arr(r.items)
    .map((x) => {
      const i = x as Record<string, unknown>;
      const t = str(i.title, 120);
      return t ? { title: t, group_name: str(i.group, 60) ?? str(i.group_name, 60) ?? 'Разное' } : null;
    })
    .filter((i): i is NonNullable<typeof i> => !!i);
  const seen = new Set<string>();
  const unique = items.filter((i) => !seen.has(i.title.toLowerCase()) && seen.add(i.title.toLowerCase())).slice(0, 100);
  return title && unique.length ? { title, items: unique } : null;
}

/** Свободный текст (сводка, совет): без разметки, разумной длины. */
export function parseText(raw: unknown, max = 1500): string | null {
  const t = (raw as { text?: unknown })?.text;
  if (typeof t !== 'string' || !t.trim()) return null;
  return t.replace(/[*#_`]/g, '').trim().slice(0, max);
}
