'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { monthGrid } from '@/lib/agenda';
import { plural } from '@/lib/dates';
import { isDayOff } from '@/lib/holidays';
import { addDays } from '@/lib/recur';
import { spanDays } from '@/lib/vacations';
import { Icon } from './icons';
import { holidayLabel } from './MiniCalendar';
import { useIsPhone } from './Phone';
import { useHolidays } from './useHolidays';
import { useModalFocus } from './useModalFocus';

const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const asDate = (day: string) => new Date(`${day}T12:00:00`);
const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`;
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
};
const monthTitle = (month: string, today: string) => {
  const s = asDate(month).toLocaleDateString('ru-RU', { month: 'long', ...(month.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) }).replace(' г.', '');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
/** «1 июля, ср», в другом году — «1 июля 2027, ср». */
export const fieldDate = (day: string, today: string) =>
  asDate(day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', ...(day.slice(0, 4) !== today.slice(0, 4) ? { year: 'numeric' } : {}) }).replace(' г.', '') +
  ', ' +
  asDate(day).toLocaleDateString('ru-RU', { weekday: 'short' });
const days = (n: number) => plural(n, 'день', 'дня', 'дней');

export type Edge = 'start' | 'end';
type Busy = { title: string; start: string; end: string };

/**
 * Выбор периода, как в Авиасейлс: сверху «Начало» и «Конец», под ними месяцы
 * (на телефоне — лентой вниз, на компьютере — два рядом со стрелками). Первое
 * нажатие — начало, второе — конец; день раньше начала становится новым
 * началом. Выходные и праздники красные, занятые другими отпусками дни не
 * нажимаются. «Выбрать» — когда есть оба дня.
 */
export default function RangePicker({
  start: start0,
  end: end0,
  edge,
  today,
  busy,
  onDone,
  onClose,
}: {
  start: string | null;
  end: string | null;
  edge: Edge;
  today: string;
  /** Другие отпуска — на них период не ложится. */
  busy: Busy[];
  onDone: (start: string, end: string) => void;
  onClose: () => void;
}) {
  const phone = useIsPhone();
  const ref = useRef<HTMLDivElement>(null);
  const body = useRef<HTMLDivElement>(null);
  useModalFocus(ref, onClose);
  const [start, setStart] = useState(start0);
  const [end, setEnd] = useState(end0);
  const [editing, setEditing] = useState<Edge>(edge === 'end' && !start0 ? 'start' : edge);
  const [hover, setHover] = useState<string | null>(null);
  const [error, setError] = useState('');
  const anchor = firstOfMonth((editing === 'end' ? end ?? start : start) ?? today);
  // Компьютер: два месяца рядом, листаются стрелками.
  const [view, setView] = useState(anchor);
  const [focusDay, setFocusDay] = useState<string | null>(null);

  // Телефон: месяцы лентой — с января этого года (или раньше, если отпуск там)
  // на полтора года вперёд.
  const first = [firstOfMonth(start ?? today), `${today.slice(0, 4)}-01-01`].sort()[0];
  const last = [firstOfMonth(end ?? today), shiftMonth(firstOfMonth(today), 18)].sort()[1];
  const months: string[] = [];
  if (phone) for (let m = first; m <= last; m = shiftMonth(m, 1)) months.push(m);
  else months.push(view, shiftMonth(view, 1));
  const holiday = useHolidays([...new Set(months.map((m) => Number(m.slice(0, 4))))]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  // Открыли — к нужному месяцу ленты, фокус на выбранный день. Фокус — в
  // обычном эффекте: окно отпуска под календарём ставит свой там же, раньше.
  useLayoutEffect(() => {
    if (phone) body.current?.querySelector<HTMLElement>(`[data-month="${anchor}"]`)?.scrollIntoView({ block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);
  useEffect(() => {
    const sel = (editing === 'end' ? end ?? start : start) ?? today;
    (body.current?.querySelector<HTMLElement>(`[data-day="${sel}"]`) ?? body.current?.querySelector<HTMLElement>('.rp-day:not([aria-disabled])'))?.focus({ preventScroll: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);
  // Стрелками ушли за край двух месяцев — листаем и ставим фокус после отрисовки.
  useEffect(() => {
    if (!focusDay) return;
    body.current?.querySelector<HTMLElement>(`[data-day="${focusDay}"]`)?.focus();
    setFocusDay(null);
  }, [focusDay, view]);

  const busyOn = (day: string) => busy.find((b) => b.start <= day && day <= b.end) ?? null;
  const clash = (a: string, b: string) => busy.find((v) => v.start <= b && a <= v.end) ?? null;

  const pick = (day: string) => {
    const b = busyOn(day);
    if (b) return setError(`Этот день уже в отпуске «${b.title}».`);
    setError('');
    if (editing === 'start' || !start || day < start) {
      setStart(day);
      if (end && (end < day || clash(day, end))) setEnd(null);
      setEditing('end');
      return;
    }
    const c = clash(start, day);
    if (c) {
      setError(`Между датами — «${c.title}». Выберите конец раньше или другое начало.`);
      return;
    }
    setEnd(day);
    setEditing('start');
  };

  // Предпросмотр полосы, пока выбирают конец (мышью или стрелками).
  const tail = editing === 'end' && start && !end && hover && hover > start && !clash(start, hover) ? hover : end;
  const n = start && end ? spanDays(start, end) : 0;
  let off = 0;
  if (holiday && start && end) for (let d = start; d <= end; d = addDays(d, 1)) if (holiday(d)?.kind === 'holiday' || holiday(d)?.kind === 'dayoff') off++;

  // Одна остановка Tab на все дни, дальше стрелками (как в мини-календаре).
  const stop = [hover, start, today].find((d) => d && months.includes(firstOfMonth(d))) ?? months[0];
  const weekdays = (
    <div className="rp-wd" aria-hidden="true">
      {WEEK.map((w, i) => (
        <span key={w} data-off={i > 4 || undefined}>
          {w}
        </span>
      ))}
    </div>
  );
  const month = (m: string) => (
    <section key={m} className="rp-month" data-month={m} aria-label={monthTitle(m, today)}>
      <h3 className="rp-month-title">{monthTitle(m, today)}</h3>
      {/* На телефоне дни недели одни на всю ленту, над ней. */}
      {!phone && weekdays}
      <div className="rp-grid">
        {monthGrid(m)
          .flat()
          .map((day) => {
            if (firstOfMonth(day) !== m) return <span key={day} aria-hidden="true" />;
            const hol = holiday?.(day) ?? null;
            const b = busyOn(day);
            const inRange = start && tail && start <= day && day <= tail;
            const range = !start ? undefined : day === start && (!tail || tail === start) ? 'one' : day === start ? 'start' : day === tail ? 'end' : inRange ? 'mid' : undefined;
            const wd = (asDate(day).getDay() + 6) % 7;
            return (
              <button
                key={day}
                type="button"
                className="rp-day"
                data-day={day}
                data-off={isDayOff(day, hol) || undefined}
                data-hol={hol?.kind === 'holiday' || undefined}
                data-today={day === today || undefined}
                data-range={range}
                data-preview={(range && !end) || undefined}
                data-edge={wd === 0 ? 'l' : wd === 6 ? 'r' : undefined}
                data-busy={b ? true : undefined}
                aria-disabled={b ? true : undefined}
                aria-pressed={day === start || day === end}
                aria-label={`${fieldDate(day, today)}${holidayLabel(hol)}${b ? `, занято: «${b.title}»` : ''}${day === start ? ', начало' : day === end ? ', конец' : ''}`}
                title={b ? `«${b.title}»` : hol?.name}
                tabIndex={day === stop ? 0 : -1}
                onClick={() => pick(day)}
                onMouseEnter={() => setHover(day)}
                onFocus={() => setHover(day)}
              >
                <span className="rp-num">{Number(day.slice(8))}</span>
              </button>
            );
          })}
      </div>
    </section>
  );

  return (
    <div className="rp-scrim" onClick={onClose}>
      <div ref={ref} className="rp" role="dialog" aria-modal="true" aria-label="Даты отпуска" onClick={(e) => e.stopPropagation()}>
        <div className="rp-head">
          <div className="rp-tabs" role="group" aria-label="Что выбираем">
            {(['start', 'end'] as const).map((k) => {
              const v = k === 'start' ? start : end;
              return (
                <button key={k} type="button" className="rp-tab" aria-pressed={editing === k} onClick={() => (k === 'end' && !start ? undefined : setEditing(k))}>
                  <small>{k === 'start' ? 'Начало' : 'Конец'}</small>
                  <b data-empty={!v || undefined}>{v ? fieldDate(v, today) : k === 'start' ? 'Выберите день' : 'Когда обратно'}</b>
                </button>
              );
            })}
          </div>
          <button className="icon-btn bare" type="button" aria-label="Закрыть" onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </div>
        {phone && weekdays}
        <div
          ref={body}
          className="rp-body"
          role="group"
          aria-label="Дни"
          onMouseLeave={() => setHover(null)}
          onKeyDown={(e) => {
            const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key];
            const cur = (e.target as HTMLElement).dataset?.day;
            if (!step || !cur) return;
            e.preventDefault();
            const next = addDays(cur, step);
            const btn = body.current?.querySelector<HTMLElement>(`[data-day="${next}"]`);
            if (btn) btn.focus();
            else if (!phone) {
              setView(shiftMonth(view, step < 0 ? -1 : 1));
              setFocusDay(next);
            }
          }}
        >
          {!phone && (
            <div className="rp-nav">
              <button className="icon-btn bare" type="button" aria-label="Предыдущий месяц" onClick={() => setView(shiftMonth(view, -1))}>
                <Icon name="back" size={18} />
              </button>
              <button className="icon-btn bare" type="button" aria-label="Следующий месяц" onClick={() => setView(shiftMonth(view, 1))} style={{ transform: 'scaleX(-1)' }}>
                <Icon name="back" size={18} />
              </button>
            </div>
          )}
          <div className="rp-months">{months.map(month)}</div>
        </div>
        <div className="rp-foot">
          <p className="rp-sum" aria-live="polite" data-tone={error ? 'danger' : undefined}>
            {error ||
              (n > 0
                ? `${days(n)}${off ? `, из них праздничных: ${off}` : ''}`
                : start
                  ? 'Теперь выберите последний день'
                  : 'Выберите первый день отпуска')}
          </p>
          {(start || end) && (
            <button
              className="btn btn-ghost"
              type="button"
              onClick={() => {
                setStart(null);
                setEnd(null);
                setEditing('start');
                setError('');
              }}
            >
              Сбросить
            </button>
          )}
          <button className="btn btn-primary" type="button" disabled={!start || !end} onClick={() => start && end && onDone(start, end)}>
            Выбрать
          </button>
        </div>
      </div>
    </div>
  );
}
