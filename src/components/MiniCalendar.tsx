'use client';

import { useState } from 'react';
import { monthGrid, type AgendaItem } from '@/lib/agenda';
import { addDays } from '@/lib/recur';
import { Icon } from './icons';

const WEEK = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const asDate = (day: string) => new Date(`${day}T12:00:00`);
const monthTitle = (month: string) => {
  const s = asDate(month).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' }).replace(' г.', '');
  return s.charAt(0).toUpperCase() + s.slice(1);
};
/** «Сегодня, 5 октября», «Завтра, 6 октября», «Пятница, 10 октября». */
export const dayHead = (day: string, today: string) => {
  const s = asDate(day).toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' });
  const rel = day === today ? 'Сегодня, ' : day === addDays(today, 1) ? 'Завтра, ' : '';
  return rel ? rel + s.split(', ')[1] : s.charAt(0).toUpperCase() + s.slice(1);
};
const firstOfMonth = (day: string) => `${day.slice(0, 7)}-01`;
const shiftMonth = (month: string, n: number) => {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10);
};
const mondayOf = (day: string) => addDays(day, -((asDate(day).getDay() + 6) % 7));

/**
 * Маленький календарь с точками-задачами. На телефоне — лента недели: ‹ ›
 * и свайп листают недели, стрелка вниз — весь месяц. На компьютере
 * (alwaysMonth) — сразу месяц. Нажали день — onPick.
 */
export function WeekStrip({
  sel,
  today,
  onPick,
  dots,
  alwaysMonth = false,
  vacation,
}: {
  sel: string;
  today: string;
  onPick: (day: string) => void;
  dots: (day: string) => AgendaItem[];
  /** Сразу месяц, без сворачивания в неделю (на компьютере места хватает). */
  alwaysMonth?: boolean;
  /** Отпуск в этот день — подсветка и подпись для диктора. */
  vacation?: (day: string) => { title: string; start: string; end: string } | null;
}) {
  const [month, setMonth] = useState<string | null>(alwaysMonth ? firstOfMonth(sel) : null);
  const [touchX, setTouchX] = useState<number | null>(null);
  const start = mondayOf(sel);
  const rows = month ? monthGrid(month) : [Array.from({ length: 7 }, (_, i) => addDays(start, i))];
  const shift = (n: number) => (month ? setMonth(shiftMonth(month, n)) : onPick(addDays(sel, n * 7)));
  return (
    <section
      className="week-strip"
      aria-label="Календарь"
      onTouchStart={(e) => setTouchX(e.touches[0].clientX)}
      onTouchEnd={(e) => {
        if (touchX === null) return;
        const dx = e.changedTouches[0].clientX - touchX;
        setTouchX(null);
        if (Math.abs(dx) > 60) shift(dx < 0 ? 1 : -1);
      }}
    >
      <div className="cal-nav">
        <button className="icon-btn bare" type="button" aria-label={month ? 'Предыдущий месяц' : 'Предыдущая неделя'} onClick={() => shift(-1)}>
          <Icon name="back" size={16} />
        </button>
        <span style={{ flex: 1, textAlign: 'center', fontWeight: 600, fontSize: 'calc(14px * var(--fs))' }}>{monthTitle(month ?? firstOfMonth(sel))}</span>
        <button className="icon-btn bare" type="button" aria-label={month ? 'Следующий месяц' : 'Следующая неделя'} onClick={() => shift(1)} style={{ transform: 'scaleX(-1)' }}>
          <Icon name="back" size={16} />
        </button>
        {!alwaysMonth && (
          <button className="icon-btn bare" type="button" aria-expanded={!!month} aria-label={month ? 'Свернуть до недели' : 'Показать месяц'} onClick={() => setMonth(month ? null : firstOfMonth(sel))}>
            <Icon name={month ? 'up' : 'down'} size={16} />
          </button>
        )}
      </div>
      {/* Дни — одна остановка Tab (выбранный день), дальше стрелками:
          ←/→ на день, ↑/↓ на неделю. Иначе месяц — 35 нажатий Tab. */}
      <div
        className="cal-grid"
        role="group"
        aria-label="Дни"
        onKeyDown={(e) => {
          const step = ({ ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 } as Record<string, number>)[e.key];
          const btns = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('.cal-day')];
          const i = btns.indexOf(e.target as HTMLButtonElement);
          if (!step || i < 0) return;
          e.preventDefault();
          btns[Math.min(btns.length - 1, Math.max(0, i + step))].focus();
        }}
      >
        {WEEK.map((w) => (
          <span key={w} className="cal-wd" aria-hidden="true">
            {w}
          </span>
        ))}
        {rows.flat().map((day, i, all) => {
          const items = dots(day);
          const vac = vacation?.(day);
          const stop = all.includes(sel) ? day === sel : all.includes(today) ? day === today : i === 0;
          return (
            <button
              key={day}
              type="button"
              className="cal-day"
              data-out={(month && firstOfMonth(day) !== month) || undefined}
              data-today={day === today || undefined}
              data-vac={vac ? (vac.start === day ? (vac.end === day ? 'one' : 'start') : vac.end === day ? 'end' : 'mid') : undefined}
              aria-pressed={day === sel}
              aria-current={day === today ? 'date' : undefined}
              tabIndex={stop ? 0 : -1}
              aria-label={`${dayHead(day, today)}${vac ? `, отпуск «${vac.title}»` : ''}${items.length ? `, задач: ${items.length}` : ''}`}
              onClick={() => {
                onPick(day);
                setMonth(alwaysMonth ? firstOfMonth(day) : null);
              }}
            >
              <span className="cal-num">{Number(day.slice(8))}</span>
              <span className="cal-dots" aria-hidden="true">
                {items
                  .filter((i) => !i.daily)
                  .slice(0, 3)
                  .map((i) => (
                    <i key={i.key} data-done={i.done || undefined} />
                  ))}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}
