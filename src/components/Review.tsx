'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { localDay } from '@/lib/dates';
import { occurrenceKey, occurrencesOn, type Occurrence } from '@/lib/occurrences';
import { reviewItems } from '@/lib/quiet';
import { addDays, describe, nextOccurrence } from '@/lib/recur';
import { dueLabel, type Task } from '@/lib/tasks';
import { useApp } from './AppShell';
import Empty from './Empty';
import { Icon } from './icons';
import { useTaskActions } from './Tasks';

/**
 * Итог дня (приходит push вечером): что не сделано сегодня — сделать или
 * перенести на завтра, по одному или всё сразу. Повторяющееся напоминание
 * не переносим — оно и так будет в свой следующий раз.
 */
export default function Review() {
  const { data, mutate, now, toast } = useApp();
  const { complete } = useTaskActions();
  const router = useRouter();
  const today = localDay(now);
  const tomorrow = addDays(today, 1);
  const occ = occurrencesOn(data.reminders, today, new Set(data.done), data.snoozed);
  const left = reviewItems(data.tasks, occ, today);

  const taskTomorrow = (t: Task) =>
    mutate(
      (d) => ({ ...d, tasks: d.tasks.map((x) => (x.id === t.id ? { ...x, due_date: tomorrow } : x)) }),
      () => api(`tasks/${t.id}`, 'PATCH', { due_date: tomorrow }),
    );
  const remDone = (o: Occurrence) => {
    const key = occurrenceKey(o.reminder.id, o.slot);
    mutate(
      (d) => ({ ...d, done: [...d.done, key] }),
      () => api(`reminders/${o.reminder.id}/done`, 'PUT', { day: today, slot: o.slot, done: true }),
    );
  };
  const remTomorrow = (o: Occurrence) =>
    mutate(
      (d) => ({ ...d, reminders: d.reminders.map((r) => (r.id === o.reminder.id ? { ...r, rule: { kind: 'once', date: tomorrow } } : r)) }),
      () => api(`reminders/${o.reminder.id}`, 'PATCH', { rule: { kind: 'once', date: tomorrow } }),
    );
  const movable = left.reminders.filter((o) => o.reminder.rule.kind === 'once');

  const allTomorrow = () => {
    left.tasks.forEach(taskTomorrow);
    // У разового напоминания с несколькими временами — переносим один раз.
    [...new Map(movable.map((o) => [o.reminder.id, o])).values()].forEach(remTomorrow);
    toast(`На завтра: ${left.tasks.length + movable.length}`);
  };

  const n = left.tasks.length + left.reminders.length;

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-head">
        <h1 className="h1 display" style={{ flex: 1 }}>
          Итог дня
        </h1>
        {left.tasks.length + movable.length > 1 && (
          <button className="btn btn-primary" type="button" onClick={allTomorrow}>
            <Icon name="calendar" size={18} />
            Всё на завтра
          </button>
        )}
      </div>
      {n === 0 ? (
        <Empty icon="check" title="Всё сделано — хорошего вечера" action="На главную" onAction={() => router.push('/')} />
      ) : (
        <ul className="review-list">
          {left.tasks.map((t) => (
            <li key={t.id} className="review-row">
              <span style={{ flex: 1, minWidth: 0 }}>
                <span style={{ fontWeight: 600 }}>{t.title}</span>
                <span className="review-meta">Дело · {dueLabel(t.due_date, today)?.text}</span>
              </span>
              <button className="btn btn-ghost" type="button" onClick={() => complete(t)} aria-label={`Сделано: ${t.title}`}>
                <Icon name="check" size={18} />
              </button>
              <button className="btn btn-ghost" type="button" onClick={() => taskTomorrow(t)}>
                Завтра
              </button>
            </li>
          ))}
          {left.reminders.map((o) => {
            const r = o.reminder;
            const next = r.rule.kind === 'once' ? null : nextOccurrence(r.rule, tomorrow, r.last_done);
            return (
              <li key={o.key} className="review-row">
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{r.title}</span>
                  <span className="review-meta">
                    {o.slot} · {r.rule.kind === 'once' ? 'один раз' : `${describe(r.rule)}${next ? `, следующий — ${next === tomorrow ? 'завтра' : next.slice(8, 10) + '.' + next.slice(5, 7)}` : ''}`}
                  </span>
                </span>
                <button className="btn btn-ghost" type="button" onClick={() => remDone(o)} aria-label={`Сделано: ${r.title}`}>
                  <Icon name="check" size={18} />
                </button>
                {r.rule.kind === 'once' && (
                  <button className="btn btn-ghost" type="button" onClick={() => remTomorrow(o)}>
                    Завтра
                  </button>
                )}
              </li>
            );
          })}
        </ul>
      )}
      <p style={{ margin: '16px 0 0', fontSize: 13, color: 'var(--muted)' }}>
        Время итога и тихие часы — в <Link href="/settings">Настройках</Link>.
      </p>
    </div>
  );
}
