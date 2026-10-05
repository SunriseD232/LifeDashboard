import { describe, expect, it } from 'vitest';
import { parseChecklist, parseJsonLoose, parseMenu, parseProducts, parseQuickAdd, parseRecipe, parseTasks, parseText } from '../aiParse';

describe('разбор ответов ИИ', () => {
  it('JSON с обёртками и текстом вокруг', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Вот ответ: {"a":2} — готово')).toEqual({ a: 2 });
    expect(() => parseJsonLoose('нет тут json')).toThrow();
  });

  it('быстрый ввод: проверяет правила, время и даты, отбрасывает мусор', () => {
    const items = parseQuickAdd({
      items: [
        { type: 'reminder', title: 'Бассейн', times: ['18:30', '25:00'], rule: { kind: 'repeat', unit: 'week', every: 1, start: '2026-10-02', weekdays: [2, 4] } },
        { type: 'reminder', title: 'Плохое правило', times: ['10:00'], rule: { kind: 'monthly' } },
        { type: 'task', title: 'Забрать посылку', due_date: '2026-10-03', tag: 'дом' },
        { type: 'task', title: 'Без даты', due_date: 'завтра', tags: ['Дом', 'дом', 'работа'], priority: 3 },
        { type: 'reminder', title: 'Без времени', rule: { kind: 'once', date: '2026-10-04' }, priority: 9 },
        { type: 'shopping', name: 'Молоко', qty: 2, unit: 'л' },
        { type: 'note', title: '', body: '' },
        { type: 'чепуха' },
      ],
    }, '08:00');
    expect(items).toEqual([
      { type: 'reminder', title: 'Бассейн', times: ['18:30'], rule: { kind: 'repeat', unit: 'week', every: 1, start: '2026-10-02', weekdays: [2, 4] }, tags: [], priority: 0 },
      // Задача с датой — у нас всегда с напоминанием, во время по умолчанию.
      { type: 'reminder', title: 'Забрать посылку', times: ['08:00'], rule: { kind: 'once', date: '2026-10-03' }, tags: ['дом'], priority: 0 },
      { type: 'task', title: 'Без даты', tags: ['Дом', 'работа'], priority: 3 },
      { type: 'reminder', title: 'Без времени', times: ['08:00'], rule: { kind: 'once', date: '2026-10-04' }, tags: [], priority: 0 },
      { type: 'shopping', name: 'молоко', qty: 2, unit: 'л' },
    ]);
  });

  it('продукты с фото — без дублей, строчными', () => {
    expect(parseProducts({ products: ['Молоко', { name: 'молоко' }, 'Яйца', 42, ''] })).toEqual(['молоко', 'яйца']);
  });

  it('рецепт: категория и единицы по справочнику', () => {
    const r = parseRecipe({
      title: 'Гренки',
      category: 'brunch',
      servings: 2,
      minutes: 10,
      ingredients: [{ name: 'Хлеб', qty: 4, unit: 'ломтик' }, { name: 'Яйца', qty: 2, unit: 'штуки' }, { name: 'Соль' }],
      steps: ['Взбить', '', 'Обжарить'],
    });
    expect(r).toEqual({
      title: 'Гренки',
      category: 'dinner',
      minutes: 10,
      servings: 2,
      ingredients: [
        { name: 'хлеб', qty: 4, unit: 'ломтик' },
        { name: 'яйца', qty: 2, unit: 'шт.' },
        { name: 'соль', qty: null, unit: null },
      ],
      steps: ['Взбить', 'Обжарить'],
    });
    expect(parseRecipe({ steps: ['x'] })).toBeNull();
  });

  it('меню — только из существующих рецептов', () => {
    const m = parseMenu({ days: [{ day: 'Пн', meals: [{ recipe_id: 'r1', meal: 'ужин' }, { recipe_id: 'выдумка' }] }, { day: 'Вт', meals: [] }] }, new Set(['r1']));
    expect(m).toEqual([{ day: 'Пн', meals: [{ recipe_id: 'r1', meal: 'ужин' }] }]);
  });

  it('дела из заметки и чек-лист поездки', () => {
    expect(parseTasks({ tasks: [{ title: 'Купить билеты', due_date: '2027-03-01' }, { title: '' }] })).toEqual([{ title: 'Купить билеты', due_date: '2027-03-01' }]);
    expect(parseChecklist({ title: 'Сочи', items: [{ title: 'Паспорт', group: 'Документы' }, { title: 'паспорт' }, { title: 'Крем' }] })).toEqual({
      title: 'Сочи',
      items: [
        { title: 'Паспорт', group_name: 'Документы' },
        { title: 'Крем', group_name: 'Разное' },
      ],
    });
  });

  it('текст без markdown', () => {
    expect(parseText({ text: '**Сегодня** дождь' })).toBe('Сегодня дождь');
    expect(parseText({})).toBeNull();
  });
});
