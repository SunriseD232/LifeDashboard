import { PHONE_SLOTS, type Section } from './nav';

/**
 * Супер-апп: главная (хаб) и разделы — «Дашборд» (дела, заметки, кухня…) и
 * «Деньги». У каждого своё нижнее меню на телефоне. Переходы едут: вглубь и
 * вправо по меню — справа налево, назад к главной и влево — слева направо.
 */

export type Context = 'hub' | 'dash' | 'money';

export interface BarItem {
  href: string;
  label: string;
  icon: string;
}

/** Главная (хаб) — первая кнопка везде. */
export const HUB_ITEM: BarItem = { href: '/', label: 'Главная', icon: 'home' };
/** Главная «Дашборда» — то, что раньше было главной LifeDashboard. */
export const TODAY_ITEM: BarItem = { href: '/today', label: 'Сегодня', icon: 'sun' };
export const MONEY_HOME: BarItem = { href: '/money', label: 'Деньги', icon: 'wallet' };

/** Меню главной: две кнопки, «+» посередине, две кнопки. */
export const HUB_BAR: [BarItem, BarItem, BarItem, BarItem] = [
  HUB_ITEM,
  { href: '/today', label: 'Дашборд', icon: 'tasks' },
  MONEY_HOME,
  { href: '/settings', label: 'Настройки', icon: 'settings' },
];

/** Меню «Денег»: главная, обзор и разделы. */
export const MONEY_BAR: BarItem[] = [
  HUB_ITEM,
  { href: '/money', label: 'Обзор', icon: 'wallet' },
  { href: '/money/ops', label: 'Операции', icon: 'list' },
  { href: '/money/report', label: 'Отчёты', icon: 'chart' },
  { href: '/money/accounts', label: 'Счета', icon: 'receipt' },
  { href: '/money/settings', label: 'Ещё', icon: 'dots' },
];

export const MORE_ITEM: BarItem = { href: '/more', label: 'Ещё', icon: 'dots' };

/** Меню «Дашборда»: главная, «Сегодня», три раздела из своего порядка, «Ещё». */
export function dashBar(phone: Section[]): BarItem[] {
  return [HUB_ITEM, TODAY_ITEM, ...phone.slice(0, PHONE_SLOTS).map((s) => ({ href: s.href, label: s.short ?? s.label, icon: s.icon })), MORE_ITEM];
}

/** Где мы: главная и её настройки — хаб, /money — «Деньги», остальное — «Дашборд». */
export function contextOf(path: string): Context {
  if (path === '/' || path === '/settings' || path.startsWith('/settings/')) return 'hub';
  if (path === '/money' || path.startsWith('/money/')) return 'money';
  return 'dash';
}

/** Какая кнопка меню — этот адрес: самое длинное совпадение («/money/ops» важнее «/money»). */
export function activeIndex(items: BarItem[], path: string): number {
  let best = -1;
  let len = -1;
  items.forEach((it, i) => {
    const hit = it.href === '/' ? path === '/' : path === it.href || path.startsWith(`${it.href}/`);
    if (hit && it.href.length > len) {
      best = i;
      len = it.href.length;
    }
  });
  return best;
}

const RANK: Record<Context, number> = { hub: 0, dash: 1, money: 2 };

/**
 * Откуда приедет новый экран. Между главной и разделом — по глубине (раздел
 * правее главной), внутри раздела — по месту в меню; не знаем — справа.
 */
export function slideFrom(from: string | null, to: string, bar: (ctx: Context) => BarItem[]): 'right' | 'left' | null {
  if (!from || from === to) return null;
  const a = contextOf(from);
  const b = contextOf(to);
  if (a !== b) {
    if (a === 'hub') return 'right';
    if (b === 'hub') return 'left';
    return RANK[b] > RANK[a] ? 'right' : 'left';
  }
  const items = bar(a);
  const i = activeIndex(items, from);
  const j = activeIndex(items, to);
  if (i < 0 || j < 0 || i === j) return 'right';
  return j > i ? 'right' : 'left';
}

/**
 * Прошлый адрес — общий для оболочек LifeDashboard и «Денег» (это одно
 * приложение, модуль живёт, пока открыта вкладка).
 */
let lastPath: string | null = null;
export function takeSlide(to: string, bar: (ctx: Context) => BarItem[]): { dir: 'right' | 'left'; cross: boolean } | null {
  const dir = slideFrom(lastPath, to, bar);
  const cross = !!lastPath && contextOf(lastPath) !== contextOf(to);
  lastPath = to;
  return dir ? { dir, cross } : null;
}

/** Класс анимации для экрана: смена раздела — едет целиком, внутри раздела — короткий сдвиг. */
export function slideClass(s: { dir: 'right' | 'left'; cross: boolean } | null): string {
  return s ? `slide-${s.cross ? 'ctx' : 'tab'}-${s.dir}` : '';
}
/** Для тестов. */
export function resetSlide() {
  lastPath = null;
}
