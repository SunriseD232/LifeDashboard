import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { cleanNutrition, nutrKey, parseDraft, parseDrafts, type Confidence, type FridgeDraft, type FridgeItem, type NutrSource, type Nutrition } from '@/lib/fridge';
import { askJson, aiConfigured, receiptModel } from './ai';
import { DAY_RE, HttpError, text, type Ctx } from './http';
import { addToPantry, productByName, scopeOf } from './kitchenStore';

/**
 * Холодильник: /api/kitchen/fridge/…
 *  receipt      POST { image | text } — ИИ читает чек: позиции и КБЖУ (черновик, не сохраняет);
 *  (без action) POST { items, bought } — положить в холодильник (и в «есть дома»);
 *  :id          PATCH { qty | nutr | title } — съели часть, поправили КБЖУ; DELETE — кончилось;
 *               POST { image } — КБЖУ с фото этикетки (точно).
 * Точное КБЖУ (этикетка, руками) запоминается по названию из чека — для
 * следующих покупок и для того же товара, что уже лежит.
 */

const MAX_IMAGE = 3_000_000;

const RECEIPT_PROMPT =
  'Ты разбираешь кассовый чек продуктового магазина (фото или текст) и оцениваешь пищевую ценность покупок. ' +
  'Для каждой строки товара: {"name":"название, как напечатано, без кода в начале строки","title":"понятное название по-русски: что это и марка, ' +
  'например «Макароны по-флотски, Перекрёсток Selection»; сокращение, которое не понимаешь, — не расшифровывай, оставь как есть",' +
  '"product":"общий продукт в именительном падеже, как в списке покупок: «макароны по-флотски», «сосиски», «пиво безалкогольное»",' +
  '"food":true|false (пакет, салфетки, бытовая химия — false),"qty":сколько штук (по столбцу количества),' +
  '"size":вес или объём одной штуки из названия числом,"size_unit":"г|мл" (кг → г, л → мл) или null,' +
  '"nutr":{"kcal":…,"protein":…,"fat":…,"carbs":…} на 100 г (для напитков — на 100 мл) или null,' +
  '"confidence":"high|mid|low","note":"для mid и low — коротко, почему не уверен"}. ' +
  'КБЖУ — по твоим знаниям о таком товаре; если знаешь именно этот товар этой марки — бери его значения. ' +
  'confidence честно: high — знаешь этот товар или продукт типовой и у всех производителей почти одинаковый (молоко 3,2%, нектар, безалкогольное пиво); ' +
  'mid — понятно, что за блюдо, но рецептура у производителей разная (готовая еда, полуфабрикаты, колбасы, десерты); ' +
  'low — не понял, что за товар, или сокращение можно прочитать по-разному. Не завышай уверенность. ' +
  '«б/а», «б/алк» — безалкогольное. Замороженные полуфабрикаты — КБЖУ до приготовления. ' +
  'Скидки, итоги, бонусы — не товары. Ответ строго JSON: {"items":[…]}. Не видно чека — {"items":[]}.';

const LABEL_PROMPT =
  'На фото упаковка продукта. Найди таблицу пищевой ценности и перепиши её на 100 г (или 100 мл). ' +
  'Если указано только на порцию — пересчитай на 100 г по весу порции. Ответ строго JSON: ' +
  '{"found":true,"kcal":…,"protein":…,"fat":…,"carbs":…} или {"found":false}, если таблицы не видно или цифры не читаются.';

interface Row {
  id: string;
  name: string;
  title: string;
  product_id: string | null;
  product: string | null;
  qty: number;
  size: number | null;
  size_unit: 'г' | 'мл' | null;
  bought: string | null;
  kcal: number | null;
  protein: number | null;
  fat: number | null;
  carbs: number | null;
  source: NutrSource;
  confidence: Confidence;
  note: string | null;
  added_by: string | null;
}

function toItem(r: Row): FridgeItem {
  return {
    id: r.id,
    name: r.name,
    title: r.title,
    product: r.product,
    product_id: r.product_id,
    qty: r.qty,
    size: r.size,
    size_unit: r.size_unit,
    food: true,
    bought: r.bought,
    added_by: r.added_by,
    nutr: r.kcal === null ? null : { kcal: r.kcal, protein: r.protein!, fat: r.fat!, carbs: r.carbs! },
    source: r.source,
    confidence: r.confidence,
    note: r.note,
  };
}

export function readFridge(d: Database.Database, scope: string): FridgeItem[] {
  return (
    d
      .prepare(
        `select f.id, f.name, f.title, f.product_id, p.name as product, f.qty, f.size, f.size_unit, f.bought,
                f.kcal, f.protein, f.fat, f.carbs, f.source, f.confidence, f.note, u.login as added_by
         from fridge_items f left join products p on p.id = f.product_id left join users u on u.id = f.added_by
         where f.scope = ? order by coalesce(f.bought, '') desc, f.created_at desc, f.title`,
      )
      .all(scope) as Row[]
  ).map(toItem);
}

function findItem(d: Database.Database, scope: string, id: unknown): Row | null {
  if (typeof id !== 'string' || !id) return null;
  return (d.prepare('select * from fridge_items where id = ? and scope = ?').get(id, scope) as Row | undefined) ?? null;
}

interface Known extends Nutrition {
  source: NutrSource;
  confidence: Confidence;
  note: string | null;
}

function known(d: Database.Database, scope: string, name: string): Known | null {
  return (d.prepare('select kcal, protein, fat, carbs, source, confidence, note from fridge_nutrition where scope = ? and key = ?').get(scope, nutrKey(name)) as
    | Known
    | undefined) ?? null;
}

/**
 * Запомнить КБЖУ товара. Оценка ИИ не перетирает этикетку или ручной ввод.
 * Точное — заодно ставим всем таким же товарам, что уже лежат.
 */
function remember(d: Database.Database, scope: string, name: string, n: Nutrition, source: NutrSource, confidence: Confidence, note: string | null): void {
  const key = nutrKey(name);
  const prev = d.prepare('select source from fridge_nutrition where scope = ? and key = ?').get(scope, key) as { source: NutrSource } | undefined;
  if (source === 'ai' && prev && prev.source !== 'ai') return;
  d.prepare(
    `insert into fridge_nutrition (scope, key, kcal, protein, fat, carbs, source, confidence, note) values (?, ?, ?, ?, ?, ?, ?, ?, ?)
     on conflict (scope, key) do update set kcal = excluded.kcal, protein = excluded.protein, fat = excluded.fat, carbs = excluded.carbs,
       source = excluded.source, confidence = excluded.confidence, note = excluded.note, updated_at = datetime('now')`,
  ).run(scope, key, n.kcal, n.protein, n.fat, n.carbs, source, confidence, note);
  if (source !== 'ai') {
    const same = (d.prepare('select id, name from fridge_items where scope = ?').all(scope) as { id: string; name: string }[]).filter((r) => nutrKey(r.name) === key);
    const upd = d.prepare("update fridge_items set kcal = ?, protein = ?, fat = ?, carbs = ?, source = ?, confidence = 'high', note = null where id = ?");
    for (const r of same) upd.run(n.kcal, n.protein, n.fat, n.carbs, source, r.id);
  }
}

/** Черновик из чека + что уже знаем о товаре: этикетка и ручной ввод важнее догадки. */
function withKnown(d: Database.Database, scope: string, x: FridgeDraft): FridgeDraft {
  if (!x.food) return x;
  const k = known(d, scope, x.name);
  if (!k || (k.source === 'ai' && x.nutr)) return x;
  return { ...x, nutr: { kcal: k.kcal, protein: k.protein, fat: k.fat, carbs: k.carbs }, source: k.source, confidence: k.source === 'ai' ? k.confidence : 'high', note: k.source === 'ai' ? k.note : null };
}

function image(v: unknown): string {
  if (typeof v !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(v) || v.length > MAX_IMAGE) {
    throw new HttpError(400, 'Нужна фотография (JPEG, PNG или WebP) поменьше.');
  }
  return v;
}

export async function fridge({ d, userId, method, body, action }: Ctx): Promise<unknown> {
  const scope = scopeOf(d, userId);

  // ---- чек → черновик ----
  if (method === 'POST' && action === 'receipt') {
    if (!aiConfigured()) throw new HttpError(503, 'ИИ пока не подключён.');
    const hasImage = typeof body.image === 'string' && body.image;
    const txt = typeof body.text === 'string' ? body.text.trim().slice(0, 20000) : '';
    if (!hasImage && !txt) throw new HttpError(400, 'Сфотографируйте чек или вставьте его текст.');
    const raw = await askJson(d, userId, {
      model: receiptModel(),
      system: RECEIPT_PROMPT,
      user: hasImage
        ? [{ type: 'text', text: 'Фото чека:' }, { type: 'image_url', image_url: { url: image(body.image) } }]
        : `Текст чека:\n${txt}`,
      maxTokens: 8000,
    });
    const items = parseDrafts(raw).map((x) => withKnown(d, scope, x));
    if (!items.length) throw new HttpError(422, 'Не нашёл в чеке товаров. Сфотографируйте ровно и при свете или вставьте текст чека.');
    return { items };
  }

  // ---- положить в холодильник ----
  if (method === 'POST' && !action) {
    if (!Array.isArray(body.items) || !body.items.length) throw new HttpError(400, 'Нечего положить.');
    const bought = typeof body.bought === 'string' && DAY_RE.test(body.bought) ? body.bought : null;
    let added = 0;
    d.transaction(() => {
      for (const raw of (body.items as unknown[]).slice(0, 200)) {
        const x = parseDraft(raw);
        if (!x || !x.food) continue;
        // Источник верим только «ai» или тому, что уже запомнено: этикетку клиент не подделает.
        const k = known(d, scope, x.name);
        const exact = k && k.source !== 'ai';
        const n = exact ? { kcal: k.kcal, protein: k.protein, fat: k.fat, carbs: k.carbs } : x.nutr;
        const source: NutrSource = exact ? k.source : 'ai';
        const confidence: Confidence = exact ? 'high' : x.confidence;
        const note = exact ? null : x.note;
        const p = x.product ? productByName(d, userId, x.product) : null;
        if (p) addToPantry(d, scope, p.id);
        // Такой же товар уже лежит — докупили: прибавляем к нему.
        const same = (d.prepare('select id, name from fridge_items where scope = ?').all(scope) as { id: string; name: string }[]).find(
          (f) => nutrKey(f.name) === nutrKey(x.name),
        );
        if (same) {
          d.prepare('update fridge_items set qty = qty + ?, bought = coalesce(?, bought) where id = ?').run(x.qty, bought, same.id);
        } else {
          d.prepare(
            `insert into fridge_items (id, scope, added_by, name, title, product_id, qty, size, size_unit, bought, kcal, protein, fat, carbs, source, confidence, note)
             values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          ).run(randomUUID(), scope, userId, x.name, x.title, p?.id ?? null, x.qty, x.size, x.size_unit, bought, n?.kcal ?? null, n?.protein ?? null, n?.fat ?? null, n?.carbs ?? null, source, confidence, note);
        }
        if (n && !exact) remember(d, scope, x.name, n, 'ai', confidence, note);
        added++;
      }
    })();
    return { added };
  }

  const item = findItem(d, scope, action);
  if (!item) throw new HttpError(404, 'Продукта нет в холодильнике.');

  // ---- этикетка ----
  if (method === 'POST') {
    if (!aiConfigured()) throw new HttpError(503, 'ИИ пока не подключён.');
    const raw = (await askJson(d, userId, {
      model: receiptModel(),
      system: LABEL_PROMPT,
      user: [{ type: 'text', text: `Продукт: ${item.title}` }, { type: 'image_url', image_url: { url: image(body.image) } }],
      maxTokens: 600,
    })) as { found?: unknown };
    const n = raw?.found === false ? null : cleanNutrition(raw);
    if (!n) throw new HttpError(422, 'Не нашёл на фото таблицу пищевой ценности. Снимите её ближе, чтобы цифры читались.');
    remember(d, scope, item.name, n, 'label', 'high', null);
    return { nutr: n };
  }

  if (method === 'PATCH') {
    d.transaction(() => {
      if (body.title !== undefined) d.prepare('update fridge_items set title = ? where id = ?').run(text(body.title, 120, 'Название'), item.id);
      if (body.qty !== undefined) {
        const q = Number(body.qty);
        if (!Number.isFinite(q) || q < 0 || q > 1000) throw new HttpError(400, 'Неверное количество.');
        if (q === 0) del(d, scope, item);
        else d.prepare('update fridge_items set qty = ? where id = ?').run(Math.round(q * 1000) / 1000, item.id);
      }
      if (body.nutr !== undefined) {
        const n = cleanNutrition(body.nutr);
        if (!n) throw new HttpError(400, 'Проверьте цифры: белки, жиры и углеводы — от 0 до 100 г на 100 г, вместе не больше 100.');
        d.prepare("update fridge_items set kcal = ?, protein = ?, fat = ?, carbs = ?, source = 'manual', confidence = 'high', note = null where id = ?").run(
          n.kcal,
          n.protein,
          n.fat,
          n.carbs,
          item.id,
        );
        remember(d, scope, item.name, n, 'manual', 'high', null);
      }
    })();
    return { ok: true };
  }

  if (method === 'DELETE') {
    d.transaction(() => del(d, scope, item))();
    return { ok: true };
  }
  return undefined;
}

/** Кончилось: убрать; последнего такого продукта больше нет — и из «есть дома». */
function del(d: Database.Database, scope: string, item: Row): void {
  d.prepare('delete from fridge_items where id = ?').run(item.id);
  if (!item.product_id) return;
  const left = d.prepare('select 1 from fridge_items where scope = ? and product_id = ? limit 1').get(scope, item.product_id);
  if (!left) d.prepare('delete from pantry where scope = ? and product_id = ?').run(scope, item.product_id);
}
