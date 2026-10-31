/**
 * Главная супер-аппа: какие плитки и в каком порядке, какие быстрые действия
 * и какие кнопки в нижнем меню. Общее для сервера (проверка сохранённого) и
 * экрана. Настраивается в Настройки → «Главная».
 */

export type TileSize = 's' | 'w';

export interface TileDef {
  id: string;
  label: string;
  /** Чем плитка занята — подпись в настройках. */
  hint: string;
  icon: string;
  size: TileSize;
  /** Только с «Деньгами». */
  money?: boolean;
  /** Показана, пока человек не решил иначе. */
  on: boolean;
}

export const TILES: TileDef[] = [
  { id: 'today', label: 'Сегодня', hint: 'Дела и напоминания дня, неделя, сводка', icon: 'tasks', size: 'w', on: true },
  { id: 'spend', label: 'Траты месяца', hint: 'Сколько потрачено и сравнение с прошлым', icon: 'chart', size: 's', money: true, on: true },
  { id: 'balance', label: 'На счетах', hint: 'Сколько денег всего', icon: 'wallet', size: 's', money: true, on: true },
  { id: 'budget', label: 'Бюджет', hint: 'Категория, где лимит ближе всего', icon: 'flag', size: 's', money: true, on: true },
  { id: 'recurring', label: 'Платежи скоро', hint: 'Подписки и платежи на неделю', icon: 'repeat', size: 's', money: true, on: true },
  { id: 'soon', label: 'Сроки', hint: 'Ближайшие дела со сроком', icon: 'calendar', size: 's', on: true },
  { id: 'shopping', label: 'Купить', hint: 'Список покупок', icon: 'cart', size: 's', on: true },
  { id: 'gym', label: 'Тренировки', hint: 'План на сегодня и неделя', icon: 'dumbbell', size: 's', on: true },
  { id: 'pinned', label: 'Закреплённые заметки', hint: 'Заметки с булавкой', icon: 'pin', size: 's', on: true },
  { id: 'goal', label: 'Цель', hint: 'Сколько накоплено', icon: 'flag', size: 'w', money: true, on: true },
  { id: 'lists', label: 'Чек-листы', hint: 'Начатые чек-листы', icon: 'list', size: 's', on: false },
  { id: 'cook', label: 'Что приготовить', hint: 'Рецепты из того, что дома', icon: 'pot', size: 's', on: false },
  { id: 'debts', label: 'Долги', hint: 'Кто кому должен', icon: 'users', size: 's', money: true, on: false },
  { id: 'rates', label: 'Курсы ЦБ', hint: 'Курсы ваших валют на сегодня', icon: 'exchange', size: 's', money: true, on: false },
];

export interface ShortcutDef {
  id: string;
  label: string;
  icon: string;
  money?: boolean;
}

export const SHORTCUTS: ShortcutDef[] = [
  { id: 'op', label: 'Трата', icon: 'plus', money: true },
  { id: 'receipt', label: 'Чек', icon: 'receipt', money: true },
  { id: 'task', label: 'Дело', icon: 'tasks' },
  { id: 'buy', label: 'Покупка', icon: 'cart' },
  { id: 'gym', label: 'Тренировка', icon: 'dumbbell' },
  { id: 'note', label: 'Заметка', icon: 'note' },
  { id: 'list', label: 'Чек-листы', icon: 'list' },
  { id: 'cook', label: 'Кухня', icon: 'pot' },
  { id: 'report', label: 'Отчёты', icon: 'chart', money: true },
  { id: 'ops', label: 'Операции', icon: 'list', money: true },
];
export const SHORTCUT_SLOTS = 5;

export interface BarChoice {
  id: string;
  href: string;
  label: string;
  icon: string;
  money?: boolean;
}

/** Что можно поставить в нижнее меню главной (четыре места вокруг «+»). */
export const BAR_CHOICES: BarChoice[] = [
  { id: 'home', href: '/', label: 'Главная', icon: 'home' },
  { id: 'tasks', href: '/tasks', label: 'Дела', icon: 'tasks' },
  { id: 'money', href: '/money', label: 'Деньги', icon: 'wallet', money: true },
  { id: 'settings', href: '/settings', label: 'Настройки', icon: 'settings' },
  { id: 'notes', href: '/notes', label: 'Заметки', icon: 'note' },
  { id: 'lists', href: '/lists', label: 'Чек-листы', icon: 'list' },
  { id: 'kitchen', href: '/kitchen', label: 'Кухня', icon: 'pot' },
  { id: 'workouts', href: '/workouts', label: 'Спорт', icon: 'dumbbell' },
  { id: 'ops', href: '/money/ops', label: 'Операции', icon: 'list', money: true },
  { id: 'report', href: '/money/report', label: 'Отчёты', icon: 'chart', money: true },
];
export const DEFAULT_BAR = ['home', 'tasks', 'money', 'settings'];
/** Без «Денег» на их месте — заметки. */
const NO_MONEY_SPARE = 'notes';

export interface HubTilePref {
  id: string;
  size: TileSize;
  hidden: boolean;
}

export interface HubPrefs {
  /** Четыре кнопки нижнего меню по порядку; null — как по умолчанию. */
  bar: string[] | null;
  /** Плитки по порядку; null — как по умолчанию. */
  tiles: HubTilePref[] | null;
  /** Быстрые действия: подбирать по частоте (auto) или только выбранные. */
  auto: boolean;
  /** Закреплённые действия — всегда первыми. */
  pins: string[];
}

export const DEFAULT_HUB: HubPrefs = { bar: null, tiles: null, auto: true, pins: [] };

const ids = (raw: unknown, known: { id: string }[], max: number): string[] => {
  if (!Array.isArray(raw)) return [];
  const ok = new Set(known.map((k) => k.id));
  return [...new Set(raw.filter((x): x is string => typeof x === 'string' && ok.has(x)))].slice(0, max);
};

/** Сохранённое → чистые настройки: неизвестное отбрасываем. */
export function parseHub(raw: unknown): HubPrefs {
  if (!raw || typeof raw !== 'object') return { ...DEFAULT_HUB };
  const r = raw as Record<string, unknown>;
  const bar = ids(r.bar, BAR_CHOICES, 4);
  let tiles: HubTilePref[] | null = null;
  if (Array.isArray(r.tiles)) {
    const known = new Set(TILES.map((t) => t.id));
    const seen = new Set<string>();
    tiles = [];
    for (const x of r.tiles as Record<string, unknown>[]) {
      const id = x?.id;
      if (typeof id !== 'string' || !known.has(id) || seen.has(id)) continue;
      seen.add(id);
      tiles.push({ id, size: x.size === 'w' ? 'w' : 's', hidden: !!x.hidden });
    }
    if (!tiles.length) tiles = null;
  }
  return { bar: bar.length === 4 ? bar : null, tiles, auto: r.auto !== false, pins: ids(r.pins, SHORTCUTS, SHORTCUT_SLOTS) };
}

/** Плитки по порядку: сохранённые, затем новые из каталога (с их видимостью по умолчанию). */
export function arrangeTiles(p: HubPrefs, hasMoney: boolean): (TileDef & { hidden: boolean })[] {
  const byId = new Map(TILES.map((t) => [t.id, t]));
  const saved = p.tiles ?? [];
  const listed = new Set(saved.map((t) => t.id));
  const all = [
    ...saved.map((t) => ({ ...byId.get(t.id)!, size: t.size, hidden: t.hidden })),
    ...TILES.filter((t) => !listed.has(t.id)).map((t) => ({ ...t, hidden: !t.on })),
  ];
  return all.filter((t) => hasMoney || !t.money);
}

/** Кнопки нижнего меню главной. Без «Денег» денежные кнопки меняем на свободные. */
export function hubBarChoices(p: HubPrefs, hasMoney: boolean): BarChoice[] {
  const byId = new Map(BAR_CHOICES.map((b) => [b.id, b]));
  const want = p.bar ?? DEFAULT_BAR;
  const out = want.map((id) => byId.get(id)!).filter((b) => hasMoney || !b.money);
  for (const spare of [NO_MONEY_SPARE, ...BAR_CHOICES.map((b) => b.id)]) {
    if (out.length >= 4) break;
    const b = byId.get(spare)!;
    if (!b.money && !out.includes(b)) out.push(b);
  }
  return out;
}

/** Части дня для счёта: ночь, утро, день, вечер. */
export function dayPart(hour: number): 0 | 1 | 2 | 3 {
  if (hour < 5) return 0;
  if (hour < 12) return 1;
  if (hour < 18) return 2;
  return 3;
}

export type HubUsage = Record<string, [number, number, number, number]>;

export function parseUsage(raw: unknown): HubUsage {
  const out: HubUsage = {};
  if (!raw || typeof raw !== 'object') return out;
  const known = new Set(SHORTCUTS.map((s) => s.id));
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!known.has(k) || !Array.isArray(v) || v.length !== 4) continue;
    out[k] = v.map((n) => (Number.isFinite(n) && (n as number) > 0 ? Math.floor(n as number) : 0)) as HubUsage[string];
  }
  return out;
}

/** Плюс одно нажатие. Большие числа делим пополам — недавние привычки важнее старых. */
export function bumpUsage(u: HubUsage, id: string, hour: number): HubUsage {
  const next: HubUsage = { ...u, [id]: [...(u[id] ?? [0, 0, 0, 0])] as HubUsage[string] };
  next[id][dayPart(hour)] += 1;
  if (next[id].some((n) => n > 200)) for (const k of Object.keys(next)) next[k] = next[k].map((n) => Math.floor(n / 2)) as HubUsage[string];
  return next;
}

/**
 * Какие действия показать: закреплённые, затем — частые в эту часть дня
 * (своя часть дня весит втрое), затем — по порядку каталога.
 */
export function pickShortcuts(p: HubPrefs, usage: HubUsage, hour: number, hasMoney: boolean): ShortcutDef[] {
  const avail = SHORTCUTS.filter((s) => hasMoney || !s.money);
  const byId = new Map(avail.map((s) => [s.id, s]));
  const pinned = p.pins.map((id) => byId.get(id)).filter((s): s is ShortcutDef => !!s);
  if (!p.auto) return pinned.length ? pinned : avail.slice(0, SHORTCUT_SLOTS);
  const part = dayPart(hour);
  const score = (id: string) => {
    const u = usage[id];
    return u ? u[part] * 3 + u.reduce((a, b) => a + b, 0) : 0;
  };
  const rest = avail
    .filter((s) => !pinned.includes(s))
    .map((s, i) => ({ s, i, n: score(s.id) }))
    .sort((a, b) => b.n - a.n || a.i - b.i)
    .map((x) => x.s);
  return [...pinned, ...rest].slice(0, SHORTCUT_SLOTS);
}
