import { COUNTRY_RE } from '@/lib/holidays';
import { HttpError, type Ctx } from '../http';
import { holidayCountries, holidaysFor } from '../holidays';
import { readSettings } from '../settings';

/**
 * Праздники: GET /api/holidays/{год}?country=RU — { country, on, days }; без
 * country — по стране из настроек (праздники выключены — days пустой).
 * Экран передаёт страну сам: только что сменили её — настройка может ещё не
 * дойти до сервера. GET /api/holidays/countries — список стран.
 */
export async function holidays({ d, userId, method, id, req }: Ctx): Promise<unknown> {
  if (method !== 'GET') return undefined;
  if (id === 'countries') return { countries: await holidayCountries() };
  const year = Number(id);
  if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new HttpError(400, 'Неверный год.');
  const asked = req.nextUrl.searchParams.get('country');
  if (asked !== null) {
    if (!COUNTRY_RE.test(asked)) throw new HttpError(400, 'Неверная страна.');
    return { country: asked, on: true, days: await holidaysFor(d, asked, year) };
  }
  const s = readSettings(d, userId);
  return { country: s.holiday_country, on: s.holidays_on, days: s.holidays_on ? await holidaysFor(d, s.holiday_country, year) : [] };
}
