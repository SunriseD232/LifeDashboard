import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';
import { migrate } from '@/lib/migrations';
import { amountLabel, cleanNutrition, parseDrafts, sizeFromName, totalOf } from '@/lib/fridge';
import { setAiTransport } from '../ai';
import { kitchen } from '../api/kitchen';
import { readFridge } from '../fridge';
import type { Ctx } from '../http';
import { readPantry, readProducts, scopeOf } from '../kitchenStore';

function setup() {
  const d = new Database(':memory:');
  d.pragma('foreign_keys = ON');
  migrate(d);
  const user = d.prepare("insert into users (id, login, password_hash) values (?, ?, 'x')");
  ['me', 'wife', 'stranger'].forEach((u) => user.run(u, u));
  d.prepare("insert into households (id, name, created_by) values ('h', 'Семья', 'me')").run();
  d.prepare("insert into household_members (user_id, household_id) values ('me', 'h'), ('wife', 'h')").run();
  return d;
}

const call = (d: Database.Database, userId: string, method: string, path: string[], body: Record<string, unknown> = {}) =>
  kitchen({ d, userId, method, body, id: path[0], action: path[1], req: { nextUrl: new URL('http://x/') } } as unknown as Ctx) as Promise<never>;

/** Ответ модели на чек из Перекрёстка (часть строк). */
const RECEIPT = {
  items: [
    {
      name: 'ПЕР.SEL.Макароны по-флотс.180г',
      title: 'Макароны по-флотски, Перекрёсток Selection',
      product: 'макароны по-флотски',
      food: true,
      qty: 1,
      size: 180,
      size_unit: 'г',
      nutr: { kcal: 170, protein: 8, fat: 7, carbs: 19 },
      confidence: 'mid',
      note: 'Готовое блюдо — у производителей рецептура разная.',
    },
    { name: 'ПЕР.SEL.Макароны по-флотс.180г', title: 'Макароны по-флотски', product: 'макароны по-флотски', food: true, qty: 1, nutr: { kcal: 170, protein: 8, fat: 7, carbs: 19 }, confidence: 'mid' },
    { name: 'Р.М.Ф-к.сел.ИС.т/о с/с кр.з115г', title: 'Р.М.Ф-к.сел.ИС.т/о с/с кр.з115г', product: 'сельдь', food: true, qty: 2, nutr: null, confidence: 'low' },
    { name: 'Пиво BAKALAR х/о.б/а ст/б 0.33л', title: 'Пиво Bakalar безалкогольное', product: 'пиво безалкогольное', food: true, qty: 1, size: 330, size_unit: 'мл', nutr: { kcal: 26, protein: 0.3, fat: 0, carbs: 5.5 }, confidence: 'high' },
    // Калории не сходятся с БЖУ — модель ошиблась.
    { name: 'V.FAN.Десерт ТИРАМИСУ 300г', title: 'Тирамису', product: 'тирамису', food: true, qty: 1, nutr: { kcal: 120, protein: 5, fat: 20, carbs: 27 }, confidence: 'high' },
    { name: 'ПЕРЕКРЕСТОК Пакет майка', title: 'Пакет', food: false, qty: 1 },
  ],
};

afterEach(() => setAiTransport(null));

describe('холодильник: разбор', () => {
  it('вес и объём из названия', () => {
    expect(sizeFromName('ПЕР.SEL.Капуста тушеная 180г')).toEqual({ size: 180, size_unit: 'г' });
    expect(sizeFromName('Пиво BAKALAR 0.33л')).toEqual({ size: 330, size_unit: 'мл' });
    expect(sizeFromName('Р.М.Ф-к.сел.ИС.т/о с/с кр.з115г')).toEqual({ size: 115, size_unit: 'г' });
    expect(sizeFromName('Хашбраун 0,4кг')).toEqual({ size: 400, size_unit: 'г' });
    expect(sizeFromName('Пакет майка')).toBeNull();
  });

  it('КБЖУ: неправдоподобное — null, без калорий — считаем', () => {
    expect(cleanNutrition({ protein: 10, fat: 10, carbs: 10 })).toEqual({ kcal: 170, protein: 10, fat: 10, carbs: 10 });
    expect(cleanNutrition({ kcal: 100, protein: 80, fat: 30, carbs: 10 })).toBeNull();
    expect(cleanNutrition({ kcal: 100, protein: -1, fat: 0, carbs: 0 })).toBeNull();
  });

  it('одинаковые строки складываются, неясное и несходящееся — «не уверен»', () => {
    const list = parseDrafts(RECEIPT);
    expect(list).toHaveLength(5);
    expect(list[0]).toMatchObject({ qty: 2, size: 180, size_unit: 'г', confidence: 'mid' });
    expect(list[1]).toMatchObject({ size: 115, confidence: 'low', nutr: null });
    expect(list[1].note).toMatch(/Не знаю/);
    expect(list[3]).toMatchObject({ confidence: 'low' });
    expect(list[3].note).toMatch(/не сходятся/);
    expect(list[4]).toMatchObject({ food: false, product: null });
  });

  it('подписи количества и итог на упаковку', () => {
    expect(amountLabel({ qty: 2, size: 115, size_unit: 'г' })).toBe('2 × 115 г');
    expect(amountLabel({ qty: 1, size: 1000, size_unit: 'мл' })).toBe('1 л');
    expect(amountLabel({ qty: 3, size: null, size_unit: null })).toBe('3 шт.');
    expect(totalOf({ qty: 2, size: 180, nutr: { kcal: 170, protein: 8, fat: 7, carbs: 19 } })).toEqual({ kcal: 612, protein: 29, fat: 25, carbs: 68 });
  });
});

describe('холодильник: сервер', () => {
  it('чек → черновик; сохранили — в холодильнике и «есть дома», общее для семьи', async () => {
    const d = setup();
    setAiTransport(async () => JSON.stringify(RECEIPT));
    const { items } = (await call(d, 'me', 'POST', ['fridge', 'receipt'], { text: 'чек' })) as { items: unknown[] };
    expect(items).toHaveLength(5);
    // Клиент прислал «с этикетки» — не верим: этикетку пишет только сервер.
    const forged = (items as Record<string, unknown>[]).map((x) => ({ ...x, source: 'label' }));
    expect(await call(d, 'me', 'POST', ['fridge'], { items: forged, bought: '2026-09-24' })).toEqual({ added: 4 });
    const list = readFridge(d, scopeOf(d, 'wife'));
    expect(list.map((i) => i.title).sort()).toEqual(['Макароны по-флотски, Перекрёсток Selection', 'Пиво Bakalar безалкогольное', 'Р.М.Ф-к.сел.ИС.т/о с/с кр.з115г', 'Тирамису']);
    expect(list.every((i) => i.source === 'ai')).toBe(true);
    expect(list.find((i) => i.title === 'Тирамису')?.confidence).toBe('low');
    const pantry = readPantry(d, scopeOf(d, 'me'));
    const names = readProducts(d).filter((p) => pantry.includes(p.id)).map((p) => p.name);
    expect(names).toEqual(expect.arrayContaining(['макароны по-флотски', 'сельдь', 'пиво безалкогольное', 'тирамису']));
    expect(readFridge(d, scopeOf(d, 'stranger'))).toHaveLength(0);
  });

  it('этикетка — точно, всем таким же и следующей покупке; ИИ её не перетирает', async () => {
    const d = setup();
    setAiTransport(async () => JSON.stringify(RECEIPT));
    const { items } = (await call(d, 'me', 'POST', ['fridge', 'receipt'], { text: 'чек' })) as { items: unknown[] };
    await call(d, 'me', 'POST', ['fridge'], { items });
    await call(d, 'me', 'POST', ['fridge'], { items });
    // Докупили то же самое — одна строка, количество сложилось.
    const herring = readFridge(d, scopeOf(d, 'me')).filter((i) => i.name.startsWith('Р.М.'));
    expect(herring).toHaveLength(1);
    expect(herring[0].qty).toBe(4);

    setAiTransport(async () => JSON.stringify({ found: true, kcal: 214, protein: 15.6, fat: 16.9, carbs: 0 }));
    await call(d, 'wife', 'POST', ['fridge', herring[0].id], { image: 'data:image/jpeg;base64,AAAA' });
    const after = readFridge(d, scopeOf(d, 'me')).find((i) => i.name.startsWith('Р.М.'));
    expect(after).toMatchObject({ source: 'label', confidence: 'high', nutr: { kcal: 214 } });

    setAiTransport(async () => JSON.stringify(RECEIPT));
    const again = (await call(d, 'me', 'POST', ['fridge', 'receipt'], { text: 'чек' })) as { items: { name: string; source: string; nutr: { kcal: number } }[] };
    expect(again.items.find((i) => i.name.startsWith('Р.М.'))).toMatchObject({ source: 'label', nutr: { kcal: 214 } });
  });

  it('этикетки не видно — понятная ошибка; ввод руками — «введено вами»', async () => {
    const d = setup();
    setAiTransport(async () => JSON.stringify(RECEIPT));
    const { items } = (await call(d, 'me', 'POST', ['fridge', 'receipt'], { text: 'чек' })) as { items: unknown[] };
    await call(d, 'me', 'POST', ['fridge'], { items });
    const beer = readFridge(d, scopeOf(d, 'me')).find((i) => i.title.startsWith('Пиво'))!;
    setAiTransport(async () => JSON.stringify({ found: false }));
    await expect(call(d, 'me', 'POST', ['fridge', beer.id], { image: 'data:image/jpeg;base64,AAAA' })).rejects.toThrow(/таблицу/);
    await expect(call(d, 'me', 'PATCH', ['fridge', beer.id], { nutr: { protein: 90, fat: 20, carbs: 0 } })).rejects.toThrow(/Проверьте/);
    await call(d, 'me', 'PATCH', ['fridge', beer.id], { nutr: { protein: 0.2, fat: 0, carbs: 4.9 } });
    expect(readFridge(d, scopeOf(d, 'me')).find((i) => i.id === beer.id)).toMatchObject({ source: 'manual', nutr: { kcal: 20, carbs: 4.9 } });
  });

  it('съели — меньше; последний кончился — и из «есть дома»; чужой не тронуть', async () => {
    const d = setup();
    setAiTransport(async () => JSON.stringify(RECEIPT));
    const { items } = (await call(d, 'me', 'POST', ['fridge', 'receipt'], { text: 'чек' })) as { items: unknown[] };
    await call(d, 'me', 'POST', ['fridge'], { items });
    const pasta = readFridge(d, scopeOf(d, 'me')).find((i) => i.title.startsWith('Макароны'))!;
    await expect(call(d, 'stranger', 'PATCH', ['fridge', pasta.id], { qty: 1 })).rejects.toThrow(/нет в холодильнике/);
    await call(d, 'wife', 'PATCH', ['fridge', pasta.id], { qty: 1 });
    expect(readFridge(d, scopeOf(d, 'me')).find((i) => i.id === pasta.id)?.qty).toBe(1);
    await call(d, 'me', 'PATCH', ['fridge', pasta.id], { qty: 0 });
    expect(readFridge(d, scopeOf(d, 'me')).find((i) => i.id === pasta.id)).toBeUndefined();
    expect(readPantry(d, scopeOf(d, 'me'))).not.toContain(pasta.product_id);
  });
});
