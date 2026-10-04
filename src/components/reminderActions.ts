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

  const done = (r: Reminder, slot: string, value: boolean) => {
    const key = occurrenceKey(r.id, slot);
    const after = r.rule.kind === 'after';
    mutate(
      (d) => ({
        ...d,
        done: value ? [...d.done.filter((x) => x !== key), key] : d.done.filter((x) => x !== key),
        snoozed: value ? d.snoozed.filter((s) => !(s.reminder_id === r.id && s.slot === slot)) : d.snoozed,
        reminders: after && value ? d.reminders.map((x) => (x.id === r.id ? { ...x, last_done: today } : x)) : d.reminders,
      }),
      async () => {
        await api(`reminders/${r.id}/done`, 'PUT', { day: today, slot, done: value });
        // Сняли отметку у «после выполнения» — прошлую дату знает сервер.
        if (after && !value) await reload();
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
