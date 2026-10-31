import { describe, expect, it } from 'vitest';
import { arrangeTiles, bumpUsage, dayPart, parseHub, parseUsage, pickShortcuts, TILES, type HubUsage } from '../hub';

describe('главная: плитки, действия, меню', () => {
  it('сохранённое чистим: чужие плитки, повторы, неполное меню', () => {
    const p = parseHub({ bar: ['home', 'tasks', 'evil'], tiles: [{ id: 'spend', size: 'w' }, { id: 'spend' }, { id: 'nope' }, { id: 'today', size: 'x', hidden: 1 }], auto: false, pins: ['op', 'op', 'zzz'] });
    expect(p).toEqual({ bar: null, tiles: [{ id: 'spend', size: 'w', hidden: false }, { id: 'today', size: 's', hidden: true }], auto: false, pins: ['op'] });
    expect(parseHub(null)).toMatchObject({ bar: null, tiles: null, auto: true, pins: [] });
  });

  it('порядок плиток: свои, затем новые из каталога; без «Денег» — без денежных', () => {
    const def = arrangeTiles(parseHub(null), true);
    expect(def.map((t) => t.id)).toEqual(TILES.map((t) => t.id));
    expect(def.find((t) => t.id === 'debts')?.hidden).toBe(true);
    const mine = arrangeTiles(parseHub({ tiles: [{ id: 'shopping', size: 'w' }, { id: 'today', size: 's', hidden: true }] }), false);
    expect(mine.slice(0, 2)).toMatchObject([
      { id: 'shopping', size: 'w', hidden: false },
      { id: 'today', size: 's', hidden: true },
    ]);
    expect(mine.some((t) => t.money)).toBe(false);
  });

  it('действия: закреплённые первыми, затем частые в эту часть дня', () => {
    let u: HubUsage = {};
    for (let i = 0; i < 4; i++) u = bumpUsage(u, 'gym', 7);
    for (let i = 0; i < 3; i++) u = bumpUsage(u, 'note', 20);
    u = bumpUsage(u, 'buy', 20);
    const p = parseHub({ pins: ['receipt'] });
    // Утро: тренировка обгоняет заметку; вечер — наоборот.
    expect(pickShortcuts(p, u, 8, true).map((s) => s.id)).toEqual(['receipt', 'gym', 'note', 'buy', 'op']);
    expect(pickShortcuts(p, u, 21, true).map((s) => s.id)).toEqual(['receipt', 'note', 'buy', 'gym', 'op']);
    // Без «Денег» денежных нет; «только мои» — ровно закреплённые.
    expect(pickShortcuts(parseHub({}), {}, 12, false).map((s) => s.id)).toEqual(['task', 'buy', 'gym', 'note', 'list']);
    expect(pickShortcuts(parseHub({ auto: false, pins: ['note', 'task'] }), u, 8, true).map((s) => s.id)).toEqual(['note', 'task']);
  });

  it('счётчики: часть дня, чистка, большие числа делятся', () => {
    expect([dayPart(3), dayPart(5), dayPart(12), dayPart(23)]).toEqual([0, 1, 2, 3]);
    expect(parseUsage({ op: [1, 2, 3, 4], bad: [1, 1, 1, 1], gym: [1, 2], note: [-1, 'x', 2.7, 0] })).toEqual({ op: [1, 2, 3, 4], note: [0, 0, 2, 0] });
    const big = bumpUsage({ op: [0, 200, 0, 0], gym: [0, 9, 0, 0] }, 'op', 9);
    expect(big).toEqual({ op: [0, 100, 0, 0], gym: [0, 4, 0, 0] });
  });
});
