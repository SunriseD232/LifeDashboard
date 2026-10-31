'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { localDay, plural } from '@/lib/dates';
import { addDays } from '@/lib/recur';
import { spanDays, vacationOn, yearCount, type Vacation, type Vacations as VacationData } from '@/lib/vacations';
import { useApp } from './AppShell';
import Confirm from './Confirm';
import Empty from './Empty';
import { Icon } from './icons';
import { WeekStrip } from './MiniCalendar';
import { Fab, Sheet, useIsPhone } from './Phone';

const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const dm = (day: string) => `${Number(day.slice(8))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

/** «1–14 июля», «28 декабря – 4 января 2027». */
export function vacationDates(v: Pick<Vacation, 'start' | 'end'>, today: string): string {
  const year = (d: string) => (d.slice(0, 4) !== today.slice(0, 4) ? ` ${d.slice(0, 4)}` : '');
  if (v.start === v.end) return dm(v.start) + year(v.start);
  if (v.start.slice(0, 7) === v.end.slice(0, 7)) return `${Number(v.start.slice(8))}–${dm(v.end)}${year(v.end)}`;
  if (v.start.slice(0, 4) !== v.end.slice(0, 4)) return `${dm(v.start)} ${v.start.slice(0, 4)} – ${dm(v.end)} ${v.end.slice(0, 4)}`;
  return `${dm(v.start)} – ${dm(v.end)}${year(v.end)}`;
}

const days = (n: number) => plural(n, 'день', 'дня', 'дней');

type Edit = { vacation?: Vacation; start?: string };

/**
 * Отпуска: периоды на календаре, счёт дней за год (сколько положено —
 * задаёт человек) и пауза повторяющихся напоминаний в эти дни
 * (src/lib/push.ts). Нажали свободный день — новый отпуск с него.
 */
export default function Vacations() {
  const { data, now, reload, toast } = useApp();
  const phone = useIsPhone();
  const today = localDay(now);
  const year = Number(today.slice(0, 4));
  const { list, allowance } = data.vacations;
  const [sel, setSel] = useState(today);
  const [edit, setEdit] = useState<Edit | null>(null);
  const count = yearCount(list, year, today, allowance);
  const current = vacationOn(list, today);
  const ahead = list.filter((v) => v.end >= today);
  const past = list.filter((v) => v.end < today && v.end.slice(0, 4) === String(year)).reverse();

  const saveAllowance = async (raw: string) => {
    const n = raw.trim() === '' ? null : Number(raw);
    if (n === allowance) return;
    try {
      await api('vacations/allowance', 'PUT', { days: n });
      await reload();
      toast('Сохранено');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const pick = (day: string) => {
    setSel(day);
    const v = vacationOn(list, day);
    setEdit(v ? { vacation: v } : { start: day });
  };

  const row = (v: Vacation) => (
    <li key={v.id}>
      <button type="button" className="vac-row" onClick={() => setEdit({ vacation: v })}>
        <span className="vac-icon" aria-hidden="true">
          <Icon name="suitcase" size={18} />
        </span>
        <span className="vac-text">
          <b>{v.title}</b>
          <small>
            {vacationDates(v, today)} · {days(spanDays(v.start, v.end))}
            {v.start <= today && today <= v.end ? ' · сейчас' : ''}
          </small>
        </span>
        {v.pause && (
          <span className="tag" title="Повторяющиеся напоминания в эти дни не приходят">
            <Icon name="bell" size={12} />
            пауза
          </span>
        )}
      </button>
    </li>
  );

  return (
    <>
      <div className="page-head">
        <h1 className="h1 display" style={{ flex: 1 }}>
          Отпуска
        </h1>
        {!phone && (
          <button className="btn btn-primary" type="button" onClick={() => setEdit({})}>
            <Icon name="plus" size={18} />
            Добавить отпуск
          </button>
        )}
      </div>

      {current && (
        <p className="vac-now" role="status">
          <Icon name="sun" size={18} />
          <span>
            Вы в отпуске до {dm(current.end)}.{current.pause ? ' Повторяющиеся напоминания на паузе.' : ''}
          </span>
        </p>
      )}

      <div className="tasks-layout vac-layout">
        <div className="tasks-main" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          <section className="card" aria-labelledby="vac-count">
            <h2 className="card-title display" id="vac-count">
              <Icon name="calendar" />
              {year} год
            </h2>
            <div className="vac-stats">
              <div>
                <b className="mono">{count.taken}</b>
                <small>уже отдохнули</small>
              </div>
              <div>
                <b className="mono">{count.planned}</b>
                <small>запланировано</small>
              </div>
              {count.left !== null && (
                <div data-tone={count.left < 0 ? 'danger' : undefined}>
                  <b className="mono">{Math.abs(count.left)}</b>
                  <small>{count.left < 0 ? 'сверх положенного' : 'осталось'}</small>
                </div>
              )}
            </div>
            {allowance !== null && allowance > 0 && (
              <div className="vac-bar" aria-hidden="true">
                <i style={{ width: `${Math.min(100, (count.taken / allowance) * 100)}%` }} />
                <i data-plan style={{ width: `${Math.max(0, Math.min(100 - (count.taken / allowance) * 100, (count.planned / allowance) * 100))}%` }} />
              </div>
            )}
            <div className="fld" style={{ maxWidth: 220 }}>
              <label className="label" htmlFor="vac-allowance">
                Положено дней в году
              </label>
              <input
                id="vac-allowance"
                key={allowance ?? 'none'}
                className="field mono"
                type="number"
                inputMode="numeric"
                min={0}
                max={366}
                placeholder="Например, 28"
                defaultValue={allowance ?? ''}
                onBlur={(e) => saveAllowance(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
              />
            </div>
          </section>

          {list.length === 0 ? (
            <Empty icon="suitcase" title="Отпусков пока нет" action="Добавить отпуск" onAction={() => setEdit({})} />
          ) : (
            <>
              {ahead.length > 0 && (
                <section aria-labelledby="vac-ahead">
                  <h2 className="group-title" id="vac-ahead">
                    Впереди
                  </h2>
                  <ul className="vac-list">{ahead.map(row)}</ul>
                </section>
              )}
              {past.length > 0 && (
                <section aria-labelledby="vac-past">
                  <h2 className="group-title" id="vac-past">
                    Прошли в этом году
                  </h2>
                  <ul className="vac-list">{past.map(row)}</ul>
                </section>
              )}
            </>
          )}
        </div>

        <aside className="tasks-side">
          <section className="card" aria-label="Календарь отпусков">
            <WeekStrip sel={sel} today={today} onPick={pick} dots={() => []} vacation={(d) => vacationOn(list, d)} alwaysMonth />
            <p style={{ margin: 0, fontSize: 'calc(13px * var(--fs))', color: 'var(--muted)' }}>Нажмите свободный день — начнём отпуск с него. Отпуск на календаре — открыть его.</p>
          </section>
        </aside>
      </div>

      {phone && <Fab label="Добавить отпуск" onClick={() => setEdit({})} />}
      {edit && <VacationSheet key={edit.vacation?.id ?? edit.start ?? 'new'} edit={edit} today={today} onClose={() => setEdit(null)} />}
    </>
  );
}

function VacationSheet({ edit, today, onClose }: { edit: Edit; today: string; onClose: () => void }) {
  const { data, reload, toast } = useApp();
  const v = edit.vacation;
  const first = v?.start ?? edit.start ?? today;
  // Новый — на две недели, но не дальше дня перед следующим отпуском.
  const next = data.vacations.list.find((x) => x.start > first)?.start;
  const twoWeeks = addDays(first, 13);
  const [title, setTitle] = useState(v?.title ?? '');
  const [start, setStart] = useState(first);
  const [end, setEnd] = useState(v?.end ?? (next && next <= twoWeeks ? addDays(next, -1) : twoWeeks));
  const [pause, setPause] = useState(v?.pause ?? true);
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(false);
  const n = spanDays(start, end);

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setBusy(true);
    try {
      await fn();
      await reload();
      toast(ok);
      onClose();
    } catch (e) {
      toast((e as Error).message);
      setBusy(false);
    }
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const body: Partial<VacationData['list'][number]> = { title: title.trim() || 'Отпуск', start, end, pause };
    run(() => (v ? api(`vacations/${v.id}`, 'PATCH', body) : api('vacations', 'POST', body)), v ? 'Отпуск изменён' : `Отпуск добавлен: ${days(n)}`);
  };

  return (
    <>
      <Sheet title={v ? 'Отпуск' : 'Новый отпуск'} onClose={onClose}>
        <form className="vac-form" onSubmit={submit}>
          <div className="fld">
            <label className="label" htmlFor="vac-title">
              Название
            </label>
            <input id="vac-title" className="field" maxLength={60} placeholder="Отпуск" value={title} onChange={(e) => setTitle(e.target.value)} />
          </div>
          <div className="vac-dates">
            <div className="fld">
              <label className="label" htmlFor="vac-start">
                С
              </label>
              <input
                id="vac-start"
                className="field"
                type="date"
                required
                value={start}
                onChange={(e) => {
                  const s = e.target.value;
                  if (!s) return;
                  // Сдвинули начало — длина сохраняется.
                  setEnd(addDays(s, Math.max(0, spanDays(start, end) - 1)));
                  setStart(s);
                }}
              />
            </div>
            <div className="fld">
              <label className="label" htmlFor="vac-end">
                По
              </label>
              <input id="vac-end" className="field" type="date" required min={start} value={end} onChange={(e) => e.target.value && setEnd(e.target.value)} />
            </div>
          </div>
          <p className="vac-span" aria-live="polite">
            {n > 0 ? `${days(n)}, календарных` : 'Конец раньше начала'}
          </p>
          <label className="check" style={{ padding: 0 }}>
            <input type="checkbox" checked={pause} onChange={(e) => setPause(e.target.checked)} />
            <span className="check-text">Не присылать повторяющиеся напоминания и вечерний итог. Разовые придут как обычно.</span>
          </label>
          <div className="vac-actions">
            {v && (
              <button className="btn btn-danger-ghost" type="button" disabled={busy} onClick={() => setRemoving(true)}>
                <Icon name="trash" size={18} />
                Удалить
              </button>
            )}
            <span style={{ flex: 1 }} />
            <button className="btn btn-primary" type="submit" disabled={busy || n <= 0}>
              {v ? 'Сохранить' : 'Добавить'}
            </button>
          </div>
        </form>
      </Sheet>
      {removing && v && (
        <Confirm
          title={`Удалить «${v.title}»?`}
          text={`${vacationDates(v, today)}, ${days(spanDays(v.start, v.end))}.`}
          action="Удалить"
          onCancel={() => setRemoving(false)}
          onConfirm={() => {
            setRemoving(false);
            run(() => api(`vacations/${v.id}`, 'DELETE'), 'Отпуск удалён');
          }}
        />
      )}
    </>
  );
}
