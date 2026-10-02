/**
 * Разделы меню и их порядок. Главная всегда первая; остальные человек
 * может переставить и скрыть (Настройки → «Разделы меню»). На телефоне в
 * нижней панели — Главная и первые три видимых, остальное — в «Ещё».
 */

export interface Section {
  href: string;
  label: string;
  icon: string;
  /** Подпись в нижней панели телефона, если полная не влезает. */
  short?: string;
  /** По умолчанию в нижней панели телефона. */
  phone?: boolean;
  /** Заголовок группы над разделом (только в порядке по умолчанию). */
  group?: string;
}

export interface NavPref {
  href: string;
  hidden?: boolean;
}

export const HOME: Section = { href: '/', label: 'Главная', icon: 'home', phone: true };

export const MOVABLE: Section[] = [
  { href: '/tasks', label: 'Дела', icon: 'tasks', phone: true },
  { href: '/notes', label: 'Заметки', icon: 'note' },
  { href: '/lists', label: 'Чек-листы', icon: 'list' },
  { href: '/reminders', label: 'Напоминания', icon: 'bell' },
  { href: '/kitchen', label: 'Кухня', icon: 'pot', phone: true, group: 'Дом и спорт' },
  { href: '/workouts', label: 'Тренировки', icon: 'dumbbell', phone: true, short: 'Спорт' },
];

/** Помощь — всегда в конце меню и в «Ещё». */
export const HELP: Section[] = [
  { href: '/guide', label: 'Как пользоваться', icon: 'help', group: 'Помощь' },
  { href: '/support', label: 'Поддержка', icon: 'chat' },
];

export const PHONE_SLOTS = 3;

/** Сохранённое → чистый список: только известные разделы, без повторов, новые — в конец. */
export function parseNav(raw: unknown): NavPref[] | null {
  if (!Array.isArray(raw)) return null;
  const known = new Set(MOVABLE.map((s) => s.href));
  const seen = new Set<string>();
  const out: NavPref[] = [];
  for (const x of raw) {
    const href = (x as NavPref)?.href;
    if (typeof href !== 'string' || !known.has(href) || seen.has(href)) continue;
    seen.add(href);
    out.push({ href, hidden: !!(x as NavPref).hidden });
  }
  return out.length ? out : null;
}

export interface Arranged {
  /** Все переставляемые разделы по порядку, со скрытыми. */
  all: (Section & { hidden: boolean })[];
  /** Видимые по порядку (без Главной). */
  visible: Section[];
  /** Что показывать в нижней панели телефона (без Главной). */
  phone: Section[];
  /** Свой порядок — группы по умолчанию тогда не показываем. */
  custom: boolean;
}

export function arrange(pref: NavPref[] | null | undefined): Arranged {
  const p = parseNav(pref);
  if (!p) {
    const all = MOVABLE.map((s) => ({ ...s, hidden: false }));
    return { all, visible: MOVABLE, phone: MOVABLE.filter((s) => s.phone), custom: false };
  }
  const byHref = new Map(MOVABLE.map((s) => [s.href, s]));
  const listed = new Set(p.map((x) => x.href));
  const all = [...p.map((x) => ({ ...byHref.get(x.href)!, hidden: !!x.hidden })), ...MOVABLE.filter((s) => !listed.has(s.href)).map((s) => ({ ...s, hidden: false }))];
  const visible = all.filter((s) => !s.hidden);
  return { all, visible, phone: visible.slice(0, PHONE_SLOTS), custom: true };
}
