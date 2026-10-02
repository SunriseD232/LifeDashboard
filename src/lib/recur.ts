/**
 * Правило повтора напоминаний — одно на экран и на рассылку push
 * (src/lib/push.ts), чтобы «бывает ли сегодня» нигде не считалось по-разному.
 *
 * Все дни — строки 'ГГГГ-ММ-ДД' в местном времени пользователя; арифметика
 * — в UTC, чтобы переход на летнее время не съедал и не удваивал сутки.
 *
 * Виды правил:
 *  - once   — один раз, в день date;
 *  - repeat — по календарю: каждые N дней / недель (по выбранным дням недели)
 *             / месяцев (число, последний день или «вторая суббота») / лет,
 *             начиная со start, с концом: никогда, до даты или после N раз;
 *  - after  — через N дней / недель / месяцев ПОСЛЕ ВЫПОЛНЕНИЯ («стирка через
 *             4 дня после прошлой»). Не сделали — дело висит каждый день,
 *             пока не отметят; первый раз — в start.
 */

export type Unit = 'day' | 'week' | 'month' | 'year';
export type AfterUnit = 'day' | 'week' | 'month';

/** Месячный повтор: число месяца (-1 — последний день) или n-й день недели (-1 — последний). */
export type Monthly = { type: 'day'; day: number } | { type: 'nth'; nth: number; weekday: number };

export type End = { type: 'never' } | { type: 'until'; date: string } | { type: 'count'; count: number };

export type Rule =
  | { kind: 'once'; date: string }
  | { kind: 'repeat'; unit: Unit; every: number; start: string; weekdays?: number[]; monthly?: Monthly; end?: End }
  | { kind: 'after'; unit: AfterUnit; every: number; start: string };

// ---------------------------------------------------------------- дни

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MS_DAY = 86_400_000;

function toUtc(day: string): number {
  const [y, m, d] = day.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function parts(day: string): { y: number; m: number; d: number } {
  const [y, m, d] = day.split('-').map(Number);
  return { y, m, d };
}

export function isDay(s: unknown): s is string {
  return typeof s === 'string' && DAY_RE.test(s) && fromUtc(toUtc(s)) === s;
}

export function addDays(day: string, n: number): string {
  return fromUtc(toUtc(day) + n * MS_DAY);
}

export function diffDays(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / MS_DAY);
}

/** 0 — воскресенье … 6 — суббота, как у Date. */
export function weekday(day: string): number {
  return new Date(toUtc(day)).getUTCDay();
}

export function daysInMonth(y: number, m: number): number {
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** +N месяцев; 31 января + 1 месяц = 28/29 февраля. */
export function addMonths(day: string, n: number): string {
  const { y, m, d } = parts(day);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));
  return `${ny}-${String(nm).padStart(2, '0')}-${String(nd).padStart(2, '0')}`;
}

function addUnit(day: string, n: number, unit: AfterUnit): string {
  if (unit === 'day') return addDays(day, n);
  if (unit === 'week') return addDays(day, n * 7);
  return addMonths(day, n);
}

/** Понедельник недели этого дня. */
function monday(day: string): string {
  return addDays(day, -((weekday(day) + 6) % 7));
}

// ---------------------------------------------------------------- расчёт

/** Подходит ли день под календарный повтор — без учёта конца. */
function matches(rule: Extract<Rule, { kind: 'repeat' }>, day: string): boolean {
  if (day < rule.start) return false;
  const { every } = rule;
  switch (rule.unit) {
    case 'day':
      return diffDays(rule.start, day) % every === 0;
    case 'week': {
      const days = rule.weekdays?.length ? rule.weekdays : [weekday(rule.start)];
      if (!days.includes(weekday(day))) return false;
      return (diffDays(monday(rule.start), monday(day)) / 7) % every === 0;
    }
    case 'month': {
      const s = parts(rule.start);
      const p = parts(day);
      if (((p.y - s.y) * 12 + (p.m - s.m)) % every !== 0) return false;
      const dim = daysInMonth(p.y, p.m);
      const mo = rule.monthly ?? { type: 'day', day: s.d };
      if (mo.type === 'day') return p.d === (mo.day === -1 ? dim : Math.min(mo.day, dim));
      if (weekday(day) !== mo.weekday) return false;
      return mo.nth === -1 ? p.d + 7 > dim : Math.ceil(p.d / 7) === mo.nth;
    }
    case 'year': {
      const s = parts(rule.start);
      const p = parts(day);
      if ((p.y - s.y) % every !== 0 || p.m !== s.m) return false;
      return p.d === Math.min(s.d, daysInMonth(p.y, p.m));
    }
  }
}

/** Предел перебора: 11 лет — хватит и для «раз в 10 лет». */
const SCAN_LIMIT = 4100;

/** Когда «после выполнения» снова пора: от последней отметки или со start. */
export function dueDay(rule: Extract<Rule, { kind: 'after' }>, lastDone: string | null): string {
  return lastDone ? addUnit(lastDone, rule.every, rule.unit) : rule.start;
}

/** Последний день повтора «N раз»: N-е совпадение от начала (или null, если дальше предела). */
function lastOfCount(rule: Extract<Rule, { kind: 'repeat' }>, count: number): string | null {
  let n = 0;
  for (let x = rule.start, i = 0; i < SCAN_LIMIT; x = addDays(x, 1), i++) {
    if (matches(rule, x) && ++n === count) return x;
  }
  return null;
}

/** Последний день повтора с учётом конца; null — без конца. */
function lastDay(rule: Extract<Rule, { kind: 'repeat' }>): string | null {
  const end = rule.end;
  if (end?.type === 'until') return end.date;
  if (end?.type === 'count') return lastOfCount(rule, end.count);
  return null;
}

/**
 * Бывает ли дело в этот день. lastDone — последний день, когда его отметили
 * сделанным (нужен только для «после выполнения»).
 */
export function occursOn(rule: Rule, day: string, lastDone: string | null = null): boolean {
  if (rule.kind === 'once') return day === rule.date;
  if (rule.kind === 'after') {
    // В день отметки дело остаётся в списке — отмеченным.
    if (lastDone && day === lastDone) return true;
    return day >= dueDay(rule, lastDone);
  }
  if (!matches(rule, day)) return false;
  const last = lastDay(rule);
  return last === null || day <= last;
}

/** Ближайший день начиная с from (включительно), когда дело будет; null — больше не будет. */
export function nextOccurrence(rule: Rule, from: string, lastDone: string | null = null): string | null {
  if (rule.kind === 'once') return rule.date >= from ? rule.date : null;
  if (rule.kind === 'after') {
    const due = dueDay(rule, lastDone);
    return due > from ? due : from;
  }
  const last = lastDay(rule);
  for (let x = from < rule.start ? rule.start : from, i = 0; i < SCAN_LIMIT; x = addDays(x, 1), i++) {
    if (last !== null && x > last) return null;
    if (matches(rule, x)) return x;
  }
  return null;
}

// ---------------------------------------------------------------- проверка

export class RuleError extends Error {}

function int(v: unknown, min: number, max: number, what: string): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) {
    throw new RuleError(`${what}: от ${min} до ${max}.`);
  }
  return v;
}

function day(v: unknown, what: string): string {
  if (!isDay(v)) throw new RuleError(`${what}: неверная дата.`);
  return v;
}

/** Разобрать правило из запроса; лишнее отбрасываем, неверное — RuleError. */
export function parseRule(x: unknown): Rule {
  const r = (x ?? {}) as Record<string, unknown>;
  if (r.kind === 'once') return { kind: 'once', date: day(r.date, 'День') };
  if (r.kind === 'after') {
    if (r.unit !== 'day' && r.unit !== 'week' && r.unit !== 'month') throw new RuleError('Неизвестный шаг повтора.');
    return { kind: 'after', unit: r.unit, every: int(r.every, 1, 365, 'Через сколько'), start: day(r.start, 'Первый раз') };
  }
  if (r.kind !== 'repeat') throw new RuleError('Неизвестный повтор.');
  if (r.unit !== 'day' && r.unit !== 'week' && r.unit !== 'month' && r.unit !== 'year') {
    throw new RuleError('Неизвестный шаг повтора.');
  }
  const out: Extract<Rule, { kind: 'repeat' }> = {
    kind: 'repeat',
    unit: r.unit,
    every: int(r.every, 1, 365, 'Каждые'),
    start: day(r.start, 'Начало'),
  };
  if (out.unit === 'week' && r.weekdays !== undefined) {
    if (!Array.isArray(r.weekdays)) throw new RuleError('Дни недели — списком.');
    const days = [...new Set(r.weekdays.map((w) => int(w, 0, 6, 'День недели')))].sort((a, b) => a - b);
    if (days.length) out.weekdays = days;
  }
  if (out.unit === 'month' && r.monthly !== undefined) {
    const m = r.monthly as Record<string, unknown>;
    if (m.type === 'day') {
      const d = int(m.day, -1, 31, 'Число месяца');
      if (d === 0) throw new RuleError('Число месяца: от 1 до 31.');
      out.monthly = { type: 'day', day: d };
    } else if (m.type === 'nth') {
      const nth = int(m.nth, -1, 5, 'Какой по счёту');
      if (nth === 0) throw new RuleError('Какой по счёту: от 1 до 5.');
      out.monthly = { type: 'nth', nth, weekday: int(m.weekday, 0, 6, 'День недели') };
    } else {
      throw new RuleError('Неизвестный месячный повтор.');
    }
  }
  if (r.end !== undefined) {
    const e = r.end as Record<string, unknown>;
    if (e.type === 'until') {
      const until = day(e.date, 'До');
      if (until < out.start) throw new RuleError('Конец раньше начала.');
      out.end = { type: 'until', date: until };
    } else if (e.type === 'count') {
      out.end = { type: 'count', count: int(e.count, 1, 1000, 'Сколько раз') };
    } else if (e.type !== 'never') {
      throw new RuleError('Неизвестный конец повтора.');
    }
  }
  return out;
}

// ---------------------------------------------------------------- подпись

const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const WEEKDAY_SHORT = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
/** Винительный падеж: «в среду». */
const WEEKDAY_ACC = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];
/** Род дня недели: м — понедельник, ж — среда, с — воскресенье. */
const WEEKDAY_GENDER = ['n', 'm', 'm', 'f', 'm', 'f', 'f'] as const;

function pl(n: number, one: string, few: string, many: string): string {
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}

/** «каждый день», «каждые 3 дня», «каждый 21 день». */
function every(n: number, unit: Unit): string {
  const words: Record<Unit, [string, string, string, string]> = {
    day: ['каждый день', 'день', 'дня', 'дней'],
    week: ['каждую неделю', 'неделю', 'недели', 'недель'],
    month: ['каждый месяц', 'месяц', 'месяца', 'месяцев'],
    year: ['каждый год', 'год', 'года', 'лет'],
  };
  const [single, one, few, many] = words[unit];
  if (n === 1) return single;
  const w = pl(n, one, few, many);
  const lead = w === one ? (unit === 'week' ? 'каждую' : 'каждый') : 'каждые';
  return `${lead} ${n} ${w}`;
}

export function dayLabel(d: string): string {
  const p = parts(d);
  return `${p.d} ${MONTHS_GEN[p.m - 1]}`;
}

function listWeekdays(days: number[]): string {
  const ordered = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((w) => WEEKDAY_SHORT[w]);
  return ordered.length > 1 ? `${ordered.slice(0, -1).join(', ')} и ${ordered[ordered.length - 1]}` : ordered[0];
}

function nthWeekday(nth: number, wd: number): string {
  const g = WEEKDAY_GENDER[wd];
  if (nth === -1) {
    const last = g === 'm' ? 'последний' : g === 'f' ? 'последнюю' : 'последнее';
    return `в ${last} ${WEEKDAY_ACC[wd]}`;
  }
  const suffix = g === 'm' ? 'й' : g === 'f' ? 'ю' : 'е';
  return `${nth === 2 ? 'во' : 'в'} ${nth}-${suffix} ${WEEKDAY_ACC[wd]}`;
}

/** Подпись правила по-русски: «каждые 2 недели по вт и чт, до 31 декабря». */
export function describe(rule: Rule): string {
  if (rule.kind === 'once') return `один раз, ${dayLabel(rule.date)}`;
  if (rule.kind === 'after') {
    const n = rule.every;
    const unit = { day: ['день', 'дня', 'дней'], week: ['неделю', 'недели', 'недель'], month: ['месяц', 'месяца', 'месяцев'] }[rule.unit];
    const span = n === 1 ? unit[0] : `${n} ${pl(n, unit[0], unit[1], unit[2])}`;
    return `через ${span} после выполнения`;
  }
  let text: string;
  const sp = parts(rule.start);
  if (rule.unit === 'week') {
    const days = rule.weekdays?.length ? rule.weekdays : [weekday(rule.start)];
    const key = days.join(',');
    if (rule.every === 1 && key === '1,2,3,4,5') text = 'по будням';
    else if (rule.every === 1 && key === '0,6') text = 'по выходным';
    else if (rule.every === 1 && days.length === 7) text = 'каждый день';
    else text = `${every(rule.every, 'week')} по ${listWeekdays(days)}`;
  } else if (rule.unit === 'month') {
    const mo = rule.monthly ?? { type: 'day', day: sp.d };
    const when =
      mo.type === 'day' ? (mo.day === -1 ? 'в последний день' : `${mo.day}-го`) : nthWeekday(mo.nth, mo.weekday);
    text = `${every(rule.every, 'month')}, ${when}`;
  } else if (rule.unit === 'year') {
    text = `${every(rule.every, 'year')}, ${sp.d} ${MONTHS_GEN[sp.m - 1]}`;
  } else {
    text = every(rule.every, 'day');
  }
  const end = rule.end;
  if (end?.type === 'until') text += `, до ${dayLabel(end.date)}`;
  if (end?.type === 'count') text += `, ${end.count} ${pl(end.count, 'раз', 'раза', 'раз')}`;
  return text;
}
