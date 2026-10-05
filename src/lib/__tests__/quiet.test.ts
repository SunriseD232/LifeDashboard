import { describe, expect, it } from 'vitest';
import type { Occurrence } from '../occurrences';
import { inQuiet, outOfQuiet, quietMissed, quietOf, reviewItems } from '../quiet';

const at = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));
const night = quietOf('23:00', '07:00');
const nap = quietOf('13:00', '15:00');
const occ = (slot: string, done = false, snoozedTo: string | null = null): Occurrence => ({
  reminder: { id: slot, title: `r${slot}`, times: [slot], checklist_id: null, last_done: null, nag: null, tags: [], priority: 0, note: null, rule: { kind: 'once', date: '2026-10-03' } },
  slot,
  key: `${slot}@${slot}`,
  done,
  snoozedTo,
});

describe('тихие часы', () => {
  it('через полночь и без', () => {
    expect(inQuiet(at('23:30'), night)).toBe(true);
    expect(inQuiet(at('03:00'), night)).toBe(true);
    expect(inQuiet(at('07:00'), night)).toBe(false);
    expect(inQuiet(at('22:59'), night)).toBe(false);
    expect(inQuiet(at('14:00'), nap)).toBe(true);
    expect(inQuiet(at('15:00'), nap)).toBe(false);
    expect(inQuiet(at('03:00'), null)).toBe(false);
    expect(quietOf('08:00', '08:00')).toBeNull();
  });
  it('время push переносится на конец тихих часов', () => {
    expect(outOfQuiet('06:30', night)).toBe('07:00');
    expect(outOfQuiet('09:00', night)).toBe('09:00');
  });
  it('утром — только неотмеченное из сегодняшней ночи', () => {
    const list = [occ('05:00'), occ('06:00', true), occ('09:00'), occ('23:30'), occ('08:00', false, '06:45')];
    expect(quietMissed(list, night).map((o) => o.slot)).toEqual(['05:00', '08:00']);
  });
  it('итог дня: неотмеченные напоминания дня', () => {
    expect(reviewItems([occ('09:00'), occ('10:00', true)])).toHaveLength(1);
  });
});
