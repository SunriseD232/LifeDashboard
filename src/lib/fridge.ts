import { normName } from './kitchen';

/**
 * Холодильник: что именно купили (из чека), сколько и КБЖУ на 100 г/мл.
 * КБЖУ бывает точным (с этикетки, введено руками) или оценкой ИИ по
 * названию — оценку честно помечаем и говорим, насколько ей верить.
 */

export interface Nutrition {
  /** На 100 г или 100 мл. */
  kcal: number;
  protein: number;
  fat: number;
  carbs: number;
}

/** label — переписано с этикетки; manual — ввёл человек; ai — догадка по названию. */
export type NutrSource = 'label' | 'manual' | 'ai';
/** Насколько верить оценке ИИ; у этикетки и ручного ввода всегда high. */
export type Confidence = 'high' | 'mid' | 'low';

export interface FridgeDraft {
  /** Как напечатано в чеке. */
  name: string;
  /** Понятное название: «Макароны по-флотски, Перекрёсток Selection». */
  title: string;
  /** Общий продукт для «есть дома» и подбора рецептов: «макароны по-флотски». */
  product: string | null;
  /** Штук (упаковок). */
  qty: number;
  /** Вес или объём одной штуки. */
  size: number | null;
  size_unit: 'г' | 'мл' | null;
  /** Еда ли это — пакет, салфетки и т. п. в холодильник не кладём. */
  food: boolean;
  nutr: Nutrition | null;
  source: NutrSource;
  confidence: Confidence;
  /** Почему не уверен — показываем человеку. */
  note: string | null;
}

export interface FridgeItem extends FridgeDraft {
  id: string;
  product_id: string | null;
  bought: string | null;
  added_by: string | null;
}

const str = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

function num(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v.replace(',', '.')) : NaN;
  return Number.isFinite(n) ? n : null;
}

/** «180г», «0.33л», «1,5кг», «з115г» → вес или объём одной штуки. */
export function sizeFromName(name: string): { size: number; size_unit: 'г' | 'мл' } | null {
  const m = /(\d+(?:[.,]\d+)?)\s*(кг|гр?|мл|л)(?![а-яё])/i.exec(name);
  if (!m) return null;
  const n = Number(m[1].replace(',', '.'));
  if (!(n > 0)) return null;
  const u = m[2].toLowerCase();
  if (u === 'кг') return { size: Math.round(n * 1000), size_unit: 'г' };
  if (u === 'л') return { size: Math.round(n * 1000), size_unit: 'мл' };
  return { size: Math.round(n), size_unit: u === 'мл' ? 'мл' : 'г' };
}

/** Энергия по БЖУ (4/9/4 ккал на грамм). */
export function kcalOf(n: Pick<Nutrition, 'protein' | 'fat' | 'carbs'>): number {
  return n.protein * 4 + n.fat * 9 + n.carbs * 4;
}

/**
 * КБЖУ из ответа модели или формы: правдоподобные числа или null.
 * Нет калорий — считаем по БЖУ.
 */
export function cleanNutrition(v: unknown): Nutrition | null {
  const o = (v ?? {}) as Record<string, unknown>;
  const p = num(o.protein);
  const f = num(o.fat);
  const c = num(o.carbs);
  if (p === null || f === null || c === null) return null;
  if ([p, f, c].some((x) => x < 0 || x > 100) || p + f + c > 101) return null;
  const k = num(o.kcal) ?? kcalOf({ protein: p, fat: f, carbs: c });
  if (k < 0 || k > 950) return null;
  const r1 = (x: number) => Math.round(x * 10) / 10;
  return { kcal: Math.round(k), protein: r1(p), fat: r1(f), carbs: r1(c) };
}

/**
 * Калории не сходятся с БЖУ больше чем на четверть (и на 40 ккал) — значит,
 * модель где-то ошиблась. Для мелких чисел (вода, чай) не придираемся.
 */
export function inconsistent(n: Nutrition): boolean {
  const calc = kcalOf(n);
  return Math.abs(calc - n.kcal) > Math.max(40, n.kcal * 0.25);
}

const CONF: Confidence[] = ['high', 'mid', 'low'];

/** Одна строка ответа модели → черновик; без названия — null. */
export function parseDraft(x: unknown): FridgeDraft | null {
  const it = (x ?? {}) as Record<string, unknown>;
  const name = str(it.name, 200);
  if (!name) return null;
  const title = str(it.title, 120) || name;
  const qtyN = num(it.qty);
  const qty = qtyN !== null && qtyN > 0 && qtyN < 1000 ? Math.round(qtyN * 1000) / 1000 : 1;
  const unit = str(it.size_unit, 4).toLowerCase();
  const sizeN = num(it.size);
  const fromName = sizeFromName(name);
  const size = sizeN !== null && sizeN > 0 && sizeN < 100000 && (unit === 'г' || unit === 'мл') ? { size: Math.round(sizeN), size_unit: unit as 'г' | 'мл' } : fromName;
  const food = it.food !== false;
  const nutr = food ? cleanNutrition(it.nutr ?? it) : null;
  let confidence: Confidence = CONF.includes(it.confidence as Confidence) ? (it.confidence as Confidence) : 'low';
  let note = str(it.note, 200) || null;
  if (food && !nutr) {
    confidence = 'low';
    note = note ?? 'Не знаю, что это за продукт — КБЖУ не оценить.';
  } else if (nutr && inconsistent(nutr)) {
    confidence = 'low';
    note = 'Калории не сходятся с БЖУ — оценка, скорее всего, ошибочная.';
  } else if (/\s\/\s|предполож/i.test(title) && confidence === 'high') {
    // «Золотой Петушок / Золотой Урожай» — модель гадает марку: не «точно».
    confidence = 'mid';
    note = note ?? 'Марку по сокращению в чеке угадал не наверняка.';
  }
  return {
    name,
    title,
    product: food ? str(it.product, 60).toLowerCase() || null : null,
    qty,
    size: size?.size ?? null,
    size_unit: size?.size_unit ?? null,
    food,
    nutr,
    source: 'ai',
    confidence: food ? confidence : 'high',
    note: food ? note : null,
  };
}

/**
 * Ответ модели {"items":[…]} → черновики. Одинаковые строки чека
 * (две пачки отдельными строками) складываем в одну.
 */
export function parseDrafts(raw: unknown): FridgeDraft[] {
  const list = (raw as { items?: unknown })?.items;
  if (!Array.isArray(list)) return [];
  const out: FridgeDraft[] = [];
  for (const x of list.slice(0, 200)) {
    const d = parseDraft(x);
    if (!d) continue;
    const same = out.find((o) => normName(o.name) === normName(d.name));
    if (same) same.qty = Math.round((same.qty + d.qty) * 1000) / 1000;
    else out.push(d);
  }
  return out;
}

/** Ключ для запоминания КБЖУ товара: название из чека без регистра и пробелов. */
export function nutrKey(name: string): string {
  return normName(name).replace(/[\s.,]+/g, ' ').trim();
}

/** Подпись уверенности: что показать и насколько предупреждать. */
export function trustLabel(source: NutrSource, confidence: Confidence): { text: string; tone: 'ok' | 'warm' | 'danger'; hint: string } {
  if (source === 'label') return { text: 'с этикетки', tone: 'ok', hint: 'Переписано с упаковки — точно.' };
  if (source === 'manual') return { text: 'введено вами', tone: 'ok', hint: 'Цифры, которые вы ввели сами.' };
  if (confidence === 'high') return { text: '≈ оценка', tone: 'ok', hint: 'Оценка ИИ по названию: продукт типовой, обычно совпадает с упаковкой в пределах 10%.' };
  if (confidence === 'mid') return { text: '≈ примерно', tone: 'warm', hint: 'Оценка ИИ по названию: у производителей состав разный, может отличаться на 20–30%.' };
  return { text: 'не уверен', tone: 'danger', hint: 'Догадка ИИ: непонятно, что это за товар, или состав сильно разнится. Лучше сфотографировать этикетку.' };
}

/** Точное ли КБЖУ (не надо предупреждать). */
export function isExact(i: Pick<FridgeDraft, 'source'>): boolean {
  return i.source !== 'ai';
}

/** Сколько всего в упаковках: на всё количество, если вес известен. */
export function totalOf(i: Pick<FridgeDraft, 'nutr' | 'size' | 'qty'>): Nutrition | null {
  if (!i.nutr || !i.size) return null;
  const k = (i.size * i.qty) / 100;
  const r = (x: number) => Math.round(x * k);
  return { kcal: r(i.nutr.kcal), protein: r(i.nutr.protein), fat: r(i.nutr.fat), carbs: r(i.nutr.carbs) };
}

/** «2 × 115 г», «0,33 л», «3 шт.». */
export function amountLabel(i: Pick<FridgeDraft, 'qty' | 'size' | 'size_unit'>): string {
  const q = String(i.qty).replace('.', ',');
  if (!i.size || !i.size_unit) return `${q} шт.`;
  const one = i.size_unit === 'мл' && i.size >= 1000 ? `${String(i.size / 1000).replace('.', ',')} л` : i.size_unit === 'г' && i.size >= 1000 ? `${String(i.size / 1000).replace('.', ',')} кг` : `${i.size} ${i.size_unit}`;
  return i.qty === 1 ? one : `${q} × ${one}`;
}
