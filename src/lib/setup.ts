import { arrangeTiles, DEFAULT_BAR, type HubPrefs } from './hub';
import { MOVABLE, type NavPref } from './nav';

/**
 * «Что вам нужно?» в знакомстве: человек включает разделы и ставит их по
 * порядку — а мы из этого одним разом собираем меню, плитки главной,
 * быстрые действия и нижнее меню. Потом всё можно поменять по отдельности.
 */

export interface SetupItem {
  id: string;
  label: string;
  icon: string;
  hint: string;
}

const HINTS: Record<string, string> = {
  '/tasks': 'дела и напоминания',
  '/notes': 'записи, закреплённое',
  '/lists': 'сборы: бассейн, поездка',
  '/vacations': 'дни отпуска, пауза напоминаний',
  '/kitchen': 'рецепты, покупки, холодильник',
  '/workouts': 'подходы, рекорды, план',
  money: 'траты, счета, бюджеты',
};

export const MONEY_ID = 'money';

export const SETUP_ITEMS: SetupItem[] = [
  ...MOVABLE.map((s) => ({ id: s.href, label: s.label, icon: s.icon, hint: HINTS[s.href] ?? '' })),
  { id: MONEY_ID, label: 'Деньги', icon: 'wallet', hint: HINTS.money },
];

export interface SetupChoice {
  id: string;
  on: boolean;
}

/** По умолчанию: «Деньги» сразу после задач, всё включено. */
export function defaultSetup(): SetupChoice[] {
  const ids = SETUP_ITEMS.map((i) => i.id).filter((id) => id !== MONEY_ID);
  ids.splice(1, 0, MONEY_ID);
  return ids.map((id) => ({ id, on: true }));
}

/** Чья плитка главной: выключили раздел — прячем и её. */
const TILE_OF: Record<string, string> = {
  spend: MONEY_ID,
  balance: MONEY_ID,
  budget: MONEY_ID,
  recurring: MONEY_ID,
  goal: MONEY_ID,
  debts: MONEY_ID,
  rates: MONEY_ID,
  soon: '/tasks',
  shopping: '/kitchen',
  cook: '/kitchen',
  gym: '/workouts',
  pinned: '/notes',
  lists: '/lists',
};

/** Чьё быстрое действие. */
const SHORTCUT_OF: Record<string, string> = {
  op: MONEY_ID,
  receipt: MONEY_ID,
  report: MONEY_ID,
  ops: MONEY_ID,
  task: '/tasks',
  buy: '/kitchen',
  cook: '/kitchen',
  gym: '/workouts',
  note: '/notes',
  list: '/lists',
};

/** Какая кнопка нижнего меню у раздела (у отпусков её нет). */
const BAR_OF: Record<string, string> = {
  '/tasks': 'tasks',
  '/notes': 'notes',
  '/lists': 'lists',
  '/kitchen': 'kitchen',
  '/workouts': 'workouts',
  [MONEY_ID]: 'money',
};

export function applySetup(choices: SetupChoice[], hub: HubPrefs): { nav: NavPref[]; hub: HubPrefs } {
  const on = new Map(choices.map((c) => [c.id, c.on]));
  const rank = new Map(choices.map((c, i) => [c.id, i]));
  const off = (section: string | undefined) => !!section && on.get(section) === false;

  const nav = choices.filter((c) => c.id !== MONEY_ID).map((c) => ({ href: c.id, hidden: !c.on }));

  // Плитки — в порядке разделов («Сегодня» — первой), чужие выключенным — спрятаны.
  const tiles = arrangeTiles(hub, true)
    .map((t, i) => ({ t, i, r: t.id === 'today' ? -1 : (rank.get(TILE_OF[t.id] ?? '') ?? choices.length) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .map(({ t }) => ({ id: t.id, size: t.size, hidden: off(TILE_OF[t.id]) || t.hidden }));

  // Нижнее меню: Главная, два первых включённых раздела, Настройки.
  const picks = choices.filter((c) => c.on && BAR_OF[c.id]).map((c) => BAR_OF[c.id]);
  const spare = ['tasks', 'notes', 'kitchen'].filter((x) => !picks.includes(x));
  const [a, b] = [...picks, ...spare];
  const bar = a && b ? ['home', a, b, 'settings'] : DEFAULT_BAR;

  const hidden = Object.entries(SHORTCUT_OF)
    .filter(([, s]) => off(s))
    .map(([id]) => id);

  return { nav, hub: { ...hub, tiles, bar, off: hidden, pins: hub.pins.filter((p) => !hidden.includes(p)) } };
}
