'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { localDay } from '@/lib/dates';
import { occurrenceKey, occurrencesOn, type Occurrence } from '@/lib/occurrences';
import { reviewItems } from '@/lib/quiet';
import { addDays, describe, nextOccurrence } from '@/lib/recur';
import { shortDate } from '@/lib/tasks';
import { isOverdue } from '@/lib/timeline';
import { useApp } from './AppShell';
import Empty from './Empty';
import { Icon } from './icons';
import { useReminderActions } from './reminderActions';

/**
 * Итог дня (приходит push вечером): какие задачи с напоминанием не сделаны —
 * сегодняшние и просроченные — сделать или перенести на завтра, по одной
 * или все сразу. Повторяющиеся не переносим — они и так будут в свой
 * следующий раз.
 */
export default function Review() {
  const { data, mutate, now, toast } = useApp();
  const rem = useReminderActions();
  const router = useRouter();
  const today = localDay(now);
  const tomorrow = addDays(today, 1);
  const occ = occurrencesOn(data.reminders, today, new Set(data.done), data.snoozed);
  const overdue: Occurrence[] = data.reminders
    .filter((r) => isOverdue(r, today))
    .flatMap((r) => r.times.map((slot) => ({ reminder: r, slot, key: occurrenceKey(r.id, slot), done: false, snoozedTo: null })));
  const left = [...overdue, ...reviewItems(occ)];

  const toTomorrow = (o: Occurrence) =>
    mutate(
      (d) => ({ ...d, reminders: d.reminders.map((r) => (r.id === o.reminder.id ? { ...r, rule: { kind: 'once', date: tomorrow } } : r)) }),
      () => api(`reminders/${o.reminder.id}`, 'PATCH', { rule: { kind: 'once', date: tomorrow } }),
    );
  const movable = left.filter((o) => o.reminder.rule.kind === 'once');
  // У разовой с несколькими временами — переносим один раз.
  const movableOnce = [...new Map(movable.map((o) => [o.reminder.id, o])).values()];

  const allTomorrow = () => {
    movableOnce.forEach(toTomorrow);
    toast(`На завтра: ${movableOnce.length}`);
  };

  return (
    <div style={{ maxWidth: 640 }}>
      <div className="page-head">
        <h1 className="h1 display" style={{ flex: 1 }}>
          Итог дня
        </h1>
        {movableOnce.length > 1 && (
          <button className="btn btn-primary" type="button" onClick={allTomorrow}>
            <Icon name="calendar" size={18} />
            Всё на завтра
          </button>
        )}
      </div>
      {left.length === 0 ? (
        <Empty icon="check" title="Всё сделано — хорошего вечера" action="На главную" onAction={() => router.push('/')} />
      ) : (
        <ul className="review-list">
          {left.map((o) => {
            const r = o.reminder;
            const next = r.rule.kind === 'once' ? null : nextOccurrence(r.rule, tomorrow, r.last_done);
            const late = r.rule.kind === 'once' && r.rule.date < today;
            return (
              <li key={`${o.key}:${late ? 'late' : 'today'}`} className="review-row">
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontWeight: 600 }}>{r.title}</span>
                  <span className="review-meta">
                    {late && r.rule.kind === 'once' ? `просрочено, было ${shortDate(r.rule.date, today)} · ` : ''}
                    {o.slot} · {r.rule.kind === 'once' ? 'один раз' : `${describe(r.rule)}${next ? `, следующий — ${next === tomorrow ? 'завтра' : shortDate(next, today)}` : ''}`}
                  </span>
                </span>
                <button className="btn btn-ghost" type="button" onClick={() => rem.done(r, o.slot, true)} aria-label={`Сделано: ${r.title}`}>
                  <Icon name="check" size={18} />
                </button>
                {r.rule.kind === 'once' && (
                  <button className="btn btn-ghost" type="button" onClick={() => toTomorrow(o)}>
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
