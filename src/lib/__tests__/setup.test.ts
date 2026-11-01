import { describe, expect, it } from 'vitest';
import { arrange } from '../nav';
import { DEFAULT_HUB, parseHub, pickShortcuts } from '../hub';
import { applySetup, defaultSetup, MONEY_ID } from '../setup';

const off = (...ids: string[]) => defaultSetup().map((c) => (ids.includes(c.id) ? { ...c, on: false } : c));

describe('«Что вам нужно?»', () => {
  it('по умолчанию всё включено, «Деньги» — после задач', () => {
    const d = defaultSetup();
    expect(d.every((c) => c.on)).toBe(true);
    expect(d.slice(0, 2).map((c) => c.id)).toEqual(['/tasks', MONEY_ID]);
  });

  it('выключенный раздел прячется в меню, порядок — как выбрали', () => {
    const choices = off('/workouts');
    [choices[0], choices[2]] = [choices[2], choices[0]];
    const { nav } = applySetup(choices, DEFAULT_HUB);
    const a = arrange(nav);
    expect(a.visible.map((s) => s.href)[0]).toBe('/notes');
    expect(a.visible.some((s) => s.href === '/workouts')).toBe(false);
  });

  it('без «Денег» — без денежных плиток, действий и кнопки внизу', () => {
    const { hub } = applySetup(off(MONEY_ID), DEFAULT_HUB);
    const p = parseHub(hub);
    expect(p.tiles!.filter((t) => ['spend', 'balance', 'goal'].includes(t.id)).every((t) => t.hidden)).toBe(true);
    expect(p.bar).toEqual(['home', 'tasks', 'notes', 'settings']);
    expect(pickShortcuts(p, {}, 10, true).some((s) => s.id === 'op')).toBe(false);
  });

  it('нижнее меню — первые два включённых раздела', () => {
    const choices = off('/tasks');
    const kitchen = choices.findIndex((c) => c.id === '/kitchen');
    const [k] = choices.splice(kitchen, 1);
    choices.unshift(k);
    expect(applySetup(choices, DEFAULT_HUB).hub.bar).toEqual(['home', 'kitchen', 'money', 'settings']);
  });

  it('«Сегодня» остаётся первой плиткой, плитки идут за разделами', () => {
    const choices = defaultSetup();
    const kitchen = choices.findIndex((c) => c.id === '/kitchen');
    const [k] = choices.splice(kitchen, 1);
    choices.unshift(k);
    const tiles = applySetup(choices, DEFAULT_HUB).hub.tiles!.map((t) => t.id);
    expect(tiles[0]).toBe('today');
    expect(tiles.indexOf('shopping')).toBeLessThan(tiles.indexOf('spend'));
  });
});
