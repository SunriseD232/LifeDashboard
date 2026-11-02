import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { migrate } from '@/lib/migrations';
import { holidays } from '../api/holidays';
import { settings } from '../api/settings';
import { setHolidaysTransport } from '../holidays';
import type { Ctx } from '../http';
import { readSettings } from '../settings';

function setup() {
  const d = new Database(':memory:');
  migrate(d);
  d.prepare("insert into users (id, login, password_hash) values ('me', 'me', 'x')").run();
  return d;
}
const req = (q = '') => ({ nextUrl: new URL(`http://x/task/api/holidays${q}`) });
const call = (d: Database.Database, id: string, q = '') =>
  holidays({ d, userId: 'me', method: 'GET', body: {}, id, req: req(q) } as unknown as Ctx) as Promise<{ country: string; on: boolean; days: { day: string; kind: string }[] }>;

describe('праздники: API', () => {
  it('страна из настроек, переносы для России, кэш, выключение', async () => {
    const urls: string[] = [];
    setHolidaysTransport(async (url) => {
      urls.push(url);
      if (url.includes('nager')) return { ok: true, json: async () => [{ date: '2026-06-12', localName: 'День России', global: true, types: ['Public'] }] };
      const months = Array.from({ length: 12 }, (_, i) => ({ month: i + 1, days: i === 5 ? '6,7,12,13,14,20,21,27,28' : '' }));
      return { ok: true, json: async () => ({ months }) };
    });
    const d = setup();
    expect(readSettings(d, 'me')).toMatchObject({ holiday_country: 'RU', holidays_on: true });
    const r = await call(d, '2026');
    expect(r.country).toBe('RU');
    expect(r.days.find((h) => h.day === '2026-06-12')).toMatchObject({ kind: 'holiday' });
    expect(urls.some((u) => u.includes('xmlcalendar.ru/data/ru/2026'))).toBe(true);
    // Второй раз — из базы, без сети.
    const n = urls.length;
    await call(d, '2026');
    expect(urls.length).toBe(n);

    await settings({ d, userId: 'me', method: 'PATCH', body: { holidays_on: false } } as unknown as Ctx);
    expect((await call(d, '2026')).days).toEqual([]);
    // Страну экран может передать сам — и при выключенных (для настроек).
    expect((await call(d, '2026', '?country=RU')).days.length).toBeGreaterThan(0);
    await expect(call(d, '2026', '?country=russia')).rejects.toThrow(/страна/);
    await expect(call(d, '1500')).rejects.toThrow(/год/);
  });

  it('страна сохраняется; чужая без производственного календаря; сеть молчит — пусто', async () => {
    const d = setup();
    await expect(settings({ d, userId: 'me', method: 'PATCH', body: { holiday_country: 'Германия' } } as unknown as Ctx)).rejects.toThrow(/страна/);
    await settings({ d, userId: 'me', method: 'PATCH', body: { holiday_country: 'DE' } } as unknown as Ctx);
    expect(readSettings(d, 'me').holiday_country).toBe('DE');
    const urls: string[] = [];
    setHolidaysTransport(async (url) => {
      urls.push(url);
      return { ok: true, json: async () => [{ date: '2026-10-03', localName: 'Tag der Deutschen Einheit', name: 'German Unity Day', global: true, types: ['Public'] }] };
    });
    expect((await call(d, '2026')).days).toEqual([{ day: '2026-10-03', name: 'German Unity Day', kind: 'holiday' }]);
    expect(urls.every((u) => !u.includes('xmlcalendar'))).toBe(true);

    setHolidaysTransport(async () => ({ ok: false, status: 503, json: async () => null }));
    expect((await call(d, '2027')).days).toEqual([]);
  });
});
