import { summarize, type Forecast } from '@/lib/weather';
import { HttpError, type Ctx } from '../http';
import { readSettings } from '../settings';

/** Прогноз меняется не чаще раза в полчаса — дальше отдаём из памяти. */
const TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; data: Forecast }>();

async function forecast(lat: number, lon: number): Promise<Forecast> {
  const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m' +
    '&hourly=temperature_2m,precipitation_probability,weather_code' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min' +
    '&timezone=auto&forecast_days=5&wind_speed_unit=ms';
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`open-meteo ${res.status}`);
  const data = (await res.json()) as Forecast;
  if (cache.size > 200) cache.clear();
  cache.set(key, { at: Date.now(), data });
  return data;
}

/** Погода для города из настроек: /api/weather. Города нет — { weather: null }. */
export async function weather({ d, userId, method, id }: Ctx): Promise<unknown> {
  if (method !== 'GET' || id) return undefined;
  const s = readSettings(d, userId);
  if (s.lat === null || s.lon === null || !s.city) return { weather: null };
  try {
    return { weather: summarize(await forecast(s.lat, s.lon), s.city) };
  } catch (e) {
    console.error('[lifedashboard weather]', (e as Error).message);
    throw new HttpError(502, 'Сервис погоды не ответил.');
  }
}
