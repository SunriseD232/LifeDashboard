import { describe, expect, it } from 'vitest';
import { occurrencesOn } from '../occurrences';
import type { Reminder } from '../types';

const pills: Reminder = {
  id: 'p', title: 'Таблетки', times: ['09:00', '21:00'], checklist_id: null, last_done: null, nag: null, tags: [], priority: 0, note: null,
  rule: { kind: 'repeat', unit: 'day', every: 1, start: '2026-10-01' },
};
const wash: Reminder = {
  id: 'w', title: 'Стирка', times: ['20:00'], checklist_id: null, last_done: '2026-09-29', nag: null, tags: [], priority: 0, note: null,
  rule: { kind: 'after', unit: 'day', every: 4, start: '2026-09-01' },
};

describe('occurrencesOn', () => {
  it('у дела с двумя временами — две отметки, по времени', () => {
    const o = occurrencesOn([pills, wash], '2026-10-03', new Set(['p@09:00']));
    expect(o.map((x) => [x.key, x.done])).toEqual([
      ['p@09:00', true],
      ['w@20:00', false],
      ['p@21:00', false],
    ]);
  });
  it('отложенное встаёт на новое время', () => {
    const o = occurrencesOn([pills], '2026-10-03', new Set(), [{ reminder_id: 'p', slot: '09:00', at: '22:00' }]);
    expect(o.map((x) => [x.slot, x.snoozedTo])).toEqual([
      ['21:00', null],
      ['09:00', '22:00'],
    ]);
  });
  it('«после выполнения» ещё рано — дела нет', () => {
    expect(occurrencesOn([wash], '2026-10-02')).toEqual([]);
  });
});
