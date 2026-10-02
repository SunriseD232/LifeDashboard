import { fromMetNo, summarize, type MetNo } from '@/lib/weather';
import { HttpError, type Ctx } from '../http';
import { readSettings } from '../settings';

/** Прогноз меняется не чаще раза в полчаса — дальше отдаём из памяти. */
const TTL_MS = 30 * 60_000;
const cache = new Map<string, { at: number; data: MetNo }>();

/** MET Norway просит представляться: имя приложения и как с нами связаться. */
const USER_AGENT = 'LifeDashboard/1.0 (+https://media-watch.ru/task)';

async function metno(lat: number, lon: number): Promise<MetNo> {
  // Не больше 4 знаков после запятой — так просит MET Norway (и кэшу лучше).
  const la = lat.toFixed(4);
  const lo = lon.toFixed(4);
  const key = `${la},${lo}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.data;
  const res = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${la}&lon=${lo}`, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`met.no ${res.status}`);
  const data = (await res.json()) as MetNo;
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
    // Пояс неизвестен (город выбран до того, как мы стали его запоминать) — Москва.
    return { weather: summarize(fromMetNo(await metno(s.lat, s.lon), s.tz ?? 'Europe/Moscow'), s.city) };
  } catch (e) {
    console.error('[lifedashboard weather]', (e as Error).message);
    throw new HttpError(502, 'Сервис погоды не ответил.');
  }
}
