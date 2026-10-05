'use client';

import { api } from '@/lib/api';
import { localDay } from '@/lib/dates';
import { occurrenceKey, type Occurrence } from '@/lib/occurrences';
import type { Reminder } from '@/lib/types';
import { useApp } from './AppShell';

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;

/** Отметить напоминание сделанным и отложить — одно поведение везде. */
export function useReminderActions() {
  const { mutate, reload, now, toast } = useApp();
  const today = localDay(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();

  const done = (r: Reminder, slot: string, value: boolean, quiet = false) => {
    const key = occurrenceKey(r.id, slot);
    if (value && !quiet) {
      navigator.vibrate?.(12);
      toast(`Сделано: «${r.title}»`, () => done(r, slot, false, true));
    }
    // last_done — по нему считаются «после выполнения» и просроченные разовые.
    const tracked = r.rule.kind === 'after' || r.rule.kind === 'once';
    mutate(
      (d) => ({
        ...d,
        done: value ? [...d.done.filter((x) => x !== key), key] : d.done.filter((x) => x !== key),
        snoozed: value ? d.snoozed.filter((s) => !(s.reminder_id === r.id && s.slot === slot)) : d.snoozed,
        reminders: tracked && value ? d.reminders.map((x) => (x.id === r.id ? { ...x, last_done: today } : x)) : d.reminders,
      }),
      async () => {
        await api(`reminders/${r.id}/done`, 'PUT', { day: today, slot, done: value });
        // Сняли отметку — прошлую дату знает сервер.
        if (tracked && !value) await reload();
      },
    );
  };

  const snooze = (o: Occurrence, minutes: number | null) => {
    const at = minutes === null ? null : nowMin + minutes;
    if (at !== null && at >= 24 * 60) {
      toast('Сегодня уже не успеть — отложить можно только в пределах дня.');
      return;
    }
    const atText = at === null ? null : hm(at);
    mutate(
      (d) => ({
        ...d,
        snoozed: [
          ...d.snoozed.filter((s) => !(s.reminder_id === o.reminder.id && s.slot === o.slot)),
          ...(atText ? [{ reminder_id: o.reminder.id, slot: o.slot, at: atText }] : []),
        ],
      }),
      () => api(`reminders/${o.reminder.id}/snooze`, 'POST', { day: today, slot: o.slot, at: atText }),
    );
    if (atText) toast(`Напомним в ${atText}`);
  };

  return { done, snooze };
}
