import { describe, expect, it } from 'vitest';
import { parseHub } from '../hub';
import { activeIndex, contextOf, dashBar, HUB_BAR, hubBar, MONEY_BAR, slideClass, slideFrom, takeSlide, resetSlide, simulatePop, wasPop, type Context } from '../superapp';

const dash = dashBar([
  { href: '/tasks', label: 'Задачи', icon: 'tasks' },
  { href: '/notes', label: 'Заметки', icon: 'note' },
  { href: '/kitchen', label: 'Кухня', icon: 'pot' },
  { href: '/workouts', label: 'Тренировки', icon: 'dumbbell' },
]);
const bar = (c: Context) => (c === 'hub' ? HUB_BAR : c === 'money' ? MONEY_BAR : dash);

describe('супер-апп: меню и переходы', () => {
  it('раздел по адресу', () => {
    expect(contextOf('/')).toBe('hub');
    expect(contextOf('/settings')).toBe('hub');
    expect(contextOf('/money')).toBe('money');
    expect(contextOf('/money/ops')).toBe('money');
    expect(contextOf('/tasks')).toBe('dash');
    expect(contextOf('/kitchen/new')).toBe('dash');
  });

  it('меню дашборда: главная, четыре раздела, ещё; у главной — свои четыре', () => {
    expect(dash.map((b) => b.label)).toEqual(['Главная', 'Задачи', 'Заметки', 'Кухня', 'Тренировки', 'Ещё']);
    expect(MONEY_BAR.map((b) => b.label)).toEqual(['Главная', 'Обзор', 'Операции', 'Отчёты', 'Счета', 'Ещё']);
    expect(HUB_BAR.map((b) => b.label)).toEqual(['Главная', 'Дела', 'Деньги', 'Настройки']);
    expect(hubBar(parseHub({ bar: ['money', 'home', 'notes', 'tasks'] })).map((b) => b.href)).toEqual(['/money', '/', '/notes', '/tasks']);
    // Без «Денег» денежные кнопки меняются на свободные.
    expect(hubBar(parseHub({ bar: ['money', 'home', 'report', 'tasks'] }), false).map((b) => b.href)).toEqual(['/', '/tasks', '/notes', '/settings']);
  });

  it('активная кнопка — самое длинное совпадение', () => {
    expect(activeIndex(MONEY_BAR, '/money')).toBe(1);
    expect(activeIndex(MONEY_BAR, '/money/ops')).toBe(2);
    expect(activeIndex(MONEY_BAR, '/money/recurring')).toBe(1);
    expect(activeIndex(dash, '/kitchen/new')).toBe(3);
    expect(activeIndex(dash, '/lists')).toBe(-1);
    expect(activeIndex(HUB_BAR, '/')).toBe(0);
  });

  it('вглубь и вправо — справа, назад и влево — слева', () => {
    expect(slideFrom('/', '/money', bar)).toBe('right');
    expect(slideFrom('/money/ops', '/', bar)).toBe('left');
    expect(slideFrom('/tasks', '/money', bar)).toBe('right');
    expect(slideFrom('/money', '/tasks', bar)).toBe('left');
    expect(slideFrom('/money', '/money/report', bar)).toBe('right');
    expect(slideFrom('/money/report', '/money/ops', bar)).toBe('left');
    expect(slideFrom('/tasks', '/workouts', bar)).toBe('right');
    expect(slideFrom(null, '/', bar)).toBeNull();
  });

  it('класс анимации: смена раздела — целиком, внутри — коротко', () => {
    resetSlide();
    expect(takeSlide('/', bar)).toBeNull();
    const a = takeSlide('/money', bar);
    expect(slideClass(a)).toBe('slide-ctx-right');
    expect(slideClass(takeSlide('/money/ops', bar))).toBe('slide-tab-right');
    expect(slideClass(takeSlide('/', bar))).toBe('slide-ctx-left');
    expect(slideClass(takeSlide('/', bar))).toBe('');
  });

  it('«назад» жестом — без своей анимации, следующий переход — как обычно', () => {
    resetSlide();
    takeSlide('/', bar);
    takeSlide('/money/ops', bar);
    simulatePop();
    expect(takeSlide('/', bar)).toBeNull();
    expect(wasPop()).toBe(true);
    expect(slideClass(takeSlide('/money', bar))).toBe('slide-ctx-right');
    expect(wasPop()).toBe(false);
  });
});
