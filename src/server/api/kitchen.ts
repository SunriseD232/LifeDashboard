import { randomUUID } from 'node:crypto';
import { findProduct, formatQty, mergeInto, type ShoppingItem } from '@/lib/kitchen';
import { CATEGORY_LABELS, SEED_RECIPES, type Category } from '@/lib/kitchenSeed';
import { householdOf } from '../household';
import { HttpError, text, type Ctx } from '../http';
import { findRecipe, productByName, readProducts, scopeOf, shoppingList } from '../kitchenStore';

const CATEGORIES = new Set(Object.keys(CATEGORY_LABELS));
const UNITS = new Set(['г', 'кг', 'мл', 'л', 'шт.', 'ст. л.', 'ч. л.', 'стакан', 'зубчик', 'ломтик', 'банка', 'пучок', 'упак.']);

interface IngredientIn {
  name?: unknown;
  qty?: unknown;
  unit?: unknown;
}

/** Ингредиенты из запроса: продукт по названию (новый — в справочник), количество, единица. */
function ingredients(d: Ctx['d'], userId: string, v: unknown) {
  if (!Array.isArray(v)) throw new HttpError(400, 'Ингредиенты — списком.');
  if (v.length > 40) throw new HttpError(400, 'Не больше 40 ингредиентов.');
  return (v as IngredientIn[])
    .filter((i) => typeof i?.name === 'string' && i.name.trim())
    .map((i) => {
      const p = productByName(d, userId, text(i.name, 60, 'Ингредиент')!);
      const qty = i.qty === null || i.qty === undefined || i.qty === '' ? null : Number(i.qty);
      if (qty !== null && (!Number.isFinite(qty) || qty <= 0 || qty > 100000)) throw new HttpError(400, `Неверное количество: ${p.name}.`);
      const unit = typeof i.unit === 'string' && UNITS.has(i.unit) ? i.unit : null;
      return { product_id: p.id, qty, unit: qty === null ? null : unit };
    });
}

function steps(v: unknown): string[] {
  if (v === undefined) return [];
  if (!Array.isArray(v)) throw new HttpError(400, 'Шаги — списком.');
  return v
    .map((s) => (typeof s === 'string' ? s.trim() : ''))
    .filter(Boolean)
    .slice(0, 30)
    .map((s) => s.slice(0, 1000));
}

function writeIngredients(d: Ctx['d'], recipeId: string, list: { product_id: string; qty: number | null; unit: string | null }[]) {
  d.prepare('delete from recipe_ingredients where recipe_id = ?').run(recipeId);
  const add = d.prepare('insert into recipe_ingredients (id, recipe_id, product_id, qty, unit, position) values (?, ?, ?, ?, ?, ?)');
  list.forEach((i, pos) => add.run(randomUUID(), recipeId, i.product_id, i.qty, i.unit, pos));
}

/**
 * Кухня: /api/kitchen/…
 *  pantry           POST { name } — есть дома; DELETE pantry/:productId — кончилось;
 *  recipes          POST, PATCH/DELETE recipes/:id — рецепты (свои или общие семьи);
 *  seed             POST — базовые рецепты (src/lib/kitchenSeed.ts), если своих ещё нет;
 *  shopping         POST { items: [{ product_id, qty, unit, recipe }] } — в покупки;
 *                   ответ { added } — для «Отменить» (shopping/undo);
 *  shopping/clear   POST — убрать купленное.
 */
export function kitchen({ d, userId, method, body, id, action }: Ctx): unknown {
  // ---- что есть дома ----
  if (id === 'pantry') {
    const scope = scopeOf(d, userId);
    if (method === 'POST' && !action) {
      const p = productByName(d, userId, text(body.name, 60, 'Продукт')!);
      d.prepare('insert or ignore into pantry (scope, product_id) values (?, ?)').run(scope, p.id);
      return { product: p };
    }
    if (method === 'DELETE' && action) {
      d.prepare('delete from pantry where scope = ? and product_id = ?').run(scope, action);
      return { ok: true };
    }
  }

  // ---- рецепты ----
  if (id === 'recipes') {
    const fields = (partial: boolean) => {
      const out: Record<string, unknown> = {};
      if (!partial || body.title !== undefined) out.title = text(body.title, 120, 'Название');
      if (!partial || body.category !== undefined) {
        if (!CATEGORIES.has(body.category)) throw new HttpError(400, 'Неизвестная категория.');
        out.category = body.category as Category;
      }
      if (!partial || body.minutes !== undefined) {
        const m = body.minutes === null || body.minutes === '' ? null : Number(body.minutes);
        if (m !== null && (!Number.isInteger(m) || m < 1 || m > 1440)) throw new HttpError(400, 'Время — в минутах, от 1 до 1440.');
        out.minutes = m;
      }
      if (!partial || body.servings !== undefined) {
        const s = Number(body.servings);
        if (!Number.isInteger(s) || s < 1 || s > 50) throw new HttpError(400, 'Порций — от 1 до 50.');
        out.servings = s;
      }
      if (!partial || body.steps !== undefined) out.steps = JSON.stringify(steps(body.steps));
      if (!partial || body.note !== undefined) out.note = text(body.note, 2000, 'Заметка', true);
      return out;
    };

    if (method === 'POST' && !action) {
      const f = fields(false);
      const rid = randomUUID();
      const hh = body.shared ? householdOf(d, userId) : null;
      d.transaction(() => {
        d.prepare(
          'insert into recipes (id, user_id, household_id, title, category, minutes, servings, steps, note) values (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(rid, userId, hh, f.title, f.category, f.minutes, f.servings, f.steps, f.note);
        writeIngredients(d, rid, ingredients(d, userId, body.ingredients ?? []));
      })();
      return { id: rid };
    }

    const r = findRecipe(d, userId, action);
    if (!r) throw new HttpError(404, 'Рецепт не найден.');
    if (method === 'PATCH') {
      const f = fields(true);
      d.transaction(() => {
        for (const [k, v] of Object.entries(f)) d.prepare(`update recipes set ${k} = ? where id = ?`).run(v, r.id);
        if (body.ingredients !== undefined) writeIngredients(d, r.id, ingredients(d, userId, body.ingredients));
        if (body.shared !== undefined) {
          if (!body.shared && r.household_id && r.user_id !== userId) throw new HttpError(403, 'Сделать личным может только автор.');
          d.prepare('update recipes set household_id = ? where id = ?').run(body.shared ? householdOf(d, userId) : null, r.id);
        }
        d.prepare("update recipes set updated_at = datetime('now') where id = ?").run(r.id);
      })();
      return { ok: true };
    }
    if (method === 'DELETE') {
      if (r.household_id && r.user_id !== userId) throw new HttpError(403, 'Удалить общий рецепт может только автор.');
      d.prepare('delete from recipes where id = ?').run(r.id);
      return { ok: true };
    }
  }

  // ---- базовые рецепты ----
  if (id === 'seed' && method === 'POST') {
    const hh = householdOf(d, userId);
    const has = d
      .prepare('select count(*) as n from recipes where user_id = ? or (household_id is not null and household_id = ?)')
      .get(userId, hh) as { n: number };
    if (has.n > 0) throw new HttpError(409, 'Рецепты уже есть — базовые добавляются только в пустую кухню.');
    const products = readProducts(d);
    d.transaction(() => {
      for (const s of SEED_RECIPES) {
        const rid = randomUUID();
        d.prepare(
          'insert into recipes (id, user_id, household_id, title, category, minutes, servings, steps) values (?, ?, ?, ?, ?, ?, ?, ?)',
        ).run(rid, userId, hh, s.title, s.category, s.minutes, s.servings, JSON.stringify(s.steps));
        writeIngredients(
          d,
          rid,
          s.ingredients.map(([name, qty, unit]) => ({ product_id: findProduct(products, name)!.id, qty, unit })),
        );
      }
    })();
    return { added: SEED_RECIPES.length };
  }

  // ---- покупки ----
  if (id === 'shopping') {
    if (method === 'POST' && !action) {
      if (!Array.isArray(body.items) || !body.items.length) throw new HttpError(400, 'Нечего добавить.');
      const list = shoppingList(d, userId, true)!;
      const products = new Map(readProducts(d).map((p) => [p.id, p]));
      const added: { id: string; created: boolean; prev: number | null }[] = [];
      d.transaction(() => {
        for (const raw of (body.items as unknown[]).slice(0, 60)) {
          const it = raw as { product_id?: unknown; name?: unknown; qty?: unknown; unit?: unknown; recipe?: unknown };
          const p = typeof it.product_id === 'string' ? products.get(it.product_id) : typeof it.name === 'string' ? productByName(d, userId, it.name) : null;
          if (!p) throw new HttpError(400, 'Неизвестный продукт.');
          const qty = typeof it.qty === 'number' && it.qty > 0 ? it.qty : null;
          const unit = qty !== null && typeof it.unit === 'string' && UNITS.has(it.unit) ? it.unit : null;
          const recipe = typeof it.recipe === 'string' ? it.recipe.slice(0, 120) : null;
          const current: ShoppingItem[] = (
            d.prepare('select id, product_id, qty, unit, done from checklist_items where checklist_id = ?').all(list.id) as (Omit<ShoppingItem, 'done'> & {
              done: number;
            })[]
          ).map((x) => ({ ...x, done: !!x.done }));
          const m = mergeInto(current, { product_id: p.id, qty, unit });
          if (m.kind === 'create') {
            const iid = randomUUID();
            const pos = ((d.prepare('select max(position) as m from checklist_items where checklist_id = ?').get(list.id) as { m: number | null }).m ?? -1) + 1;
            d.prepare(
              `insert into checklist_items (id, checklist_id, user_id, title, group_name, note, position, product_id, qty, unit, recipe_title)
               values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            ).run(iid, list.id, userId, p.name, p.dept, noteOf(qty, unit, recipe), pos, p.id, qty, unit, recipe);
            added.push({ id: iid, created: true, prev: null });
          } else if (m.kind === 'add') {
            d.prepare('update checklist_items set qty = ?, note = ? where id = ?').run(m.qty, noteOf(m.qty, unit, recipe), m.id);
            added.push({ id: m.id, created: false, prev: m.prev });
          }
        }
      })();
      return { added, checklist_id: list.id };
    }

    const list = shoppingList(d, userId, false);
    if (method === 'POST' && action === 'undo' && list) {
      const added = Array.isArray(body.added) ? (body.added as { id?: unknown; created?: unknown; prev?: unknown }[]) : [];
      d.transaction(() => {
        for (const a of added.slice(0, 60)) {
          if (typeof a.id !== 'string') continue;
          if (a.created) d.prepare('delete from checklist_items where id = ? and checklist_id = ?').run(a.id, list.id);
          else if (typeof a.prev === 'number') {
            const row = d.prepare('select unit, recipe_title from checklist_items where id = ? and checklist_id = ?').get(a.id, list.id) as
              | { unit: string | null; recipe_title: string | null }
              | undefined;
            if (row) d.prepare('update checklist_items set qty = ?, note = ? where id = ?').run(a.prev, noteOf(a.prev, row.unit, row.recipe_title), a.id);
          }
        }
      })();
      return { ok: true };
    }
    if (method === 'POST' && action === 'clear' && list) {
      d.prepare('delete from checklist_items where checklist_id = ? and done = 1').run(list.id);
      return { ok: true };
    }
  }

  return undefined;
}

/** Подпись пункта покупок в обычном чек-листе: «200 мл · паста». */
function noteOf(qty: number | null, unit: string | null, recipe: string | null): string | null {
  const parts = [qty !== null ? formatQty(qty, unit) : null, recipe ? recipe.toLowerCase() : null].filter(Boolean);
  return parts.length ? parts.join(' · ').slice(0, 120) : null;
}
