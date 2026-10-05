import { describe, expect, it, vi } from 'vitest';

// push.ts при импорте тянет базу и web-push — для чистой функции они не нужны.
vi.mock('../db', () => ({ db: () => { throw new Error('нет базы в тесте'); } }));

const { sendsDue } = await import('../push');
import type { Occurrence } from '../occurrences';

const occ = (over: Partial<Occurrence>): Occurrence => ({
  reminder: { id: 'r', title: 'Таблетки', times: ['09:00'], checklist_id: null, last_done: null, nag: null, tags: [], priority: 0, note: null, rule: { kind: 'once', date: '2026-10-02' } },
  slot: '09:00', key: 'r@09:00', done: false, snoozedTo: null, ...over,
});
const nagging = (over: Partial<Occurrence>) => { const o = occ(over); return { ...o, reminder: { ...o.reminder, nag: 30 } }; };
const at = (hm: string) => Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3));

describe('sendsDue', () => {
  it('в окне 10 минут после времени — шлём, раньше и позже — нет', () => {
    expect(sendsDue(occ({}), at('08:59'))).toEqual([]);
    expect(sendsDue(occ({}), at('09:00'))).toEqual([{ mark: '09:00', hm: '09:00' }]);
    expect(sendsDue(occ({}), at('09:10'))).toHaveLength(1);
    expect(sendsDue(occ({}), at('09:11'))).toEqual([]);
  });
  it('сделано — молчим', () => {
    expect(sendsDue(occ({ done: true }), at('09:00'))).toEqual([]);
  });
  it('отложенное шлётся в новое время со своей отметкой', () => {
    expect(sendsDue(occ({ snoozedTo: '10:00' }), at('10:02'))).toEqual([{ mark: '09:00>10:00', hm: '10:00' }]);
  });
  it('не отметили — повтор через nag минут, до трёх раз', () => {
    expect(sendsDue(nagging({}), at('09:20'))).toEqual([]);
    expect(sendsDue(nagging({}), at('09:31'))).toEqual([{ mark: '09:00+1', hm: '09:00', repeat: 1 }]);
    expect(sendsDue(nagging({}), at('10:30'))).toEqual([{ mark: '09:00+3', hm: '09:00', repeat: 3 }]);
    expect(sendsDue(nagging({}), at('11:00'))).toEqual([]);
    expect(sendsDue(nagging({ done: true }), at('09:31'))).toEqual([]);
  });
  it('отложили — повторы считаются от нового времени', () => {
    expect(sendsDue(nagging({ snoozedTo: '10:00' }), at('09:31'))).toEqual([]);
    expect(sendsDue(nagging({ snoozedTo: '10:00' }), at('10:30'))).toEqual([{ mark: '10:00+1', hm: '10:00', repeat: 1 }]);
  });
});
