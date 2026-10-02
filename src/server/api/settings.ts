import { HttpError, text, type Ctx } from '../http';
import { readSettings } from '../settings';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Настройки человека: /api/settings и поиск города /api/settings/geocode?q=.
 * Город ищем у Open-Meteo (тот же сервис, что даёт погоду), сохраняем
 * название и координаты.
 */
export async function settings({ d, userId, method, body, id, req }: Ctx): Promise<unknown> {
  if (method === 'GET' && id === 'geocode') {
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
    if (q.length < 2) return { results: [] };
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.slice(0, 80))}&count=6&language=ru&format=json`;
    let data: { results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number }[] };
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
      if (!res.ok) throw new Error(String(res.status));
      data = await res.json();
    } catch {
      throw new HttpError(502, 'Не удалось найти город — сервис погоды не ответил. Попробуйте ещё раз.');
    }
    return {
      results: (data.results ?? []).map((r) => ({
        name: r.name,
        region: [r.admin1, r.country].filter(Boolean).join(', '),
        lat: r.latitude,
        lon: r.longitude,
      })),
    };
  }

  if (method === 'PATCH' && !id) {
    const cur = readSettings(d, userId);
    let { city, lat, lon, deadline_time } = cur;
    if (body.city !== undefined) {
      if (body.city === null) {
        city = null;
        lat = null;
        lon = null;
      } else {
        city = text(body.city, 120, 'Город');
        const la = Number(body.lat);
        const lo = Number(body.lon);
        if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
          throw new HttpError(400, 'Неверные координаты города.');
        }
        lat = la;
        lon = lo;
      }
    }
    if (body.deadline_time !== undefined) {
      if (typeof body.deadline_time !== 'string' || !TIME_RE.test(body.deadline_time)) throw new HttpError(400, 'Неверное время.');
      deadline_time = body.deadline_time;
    }
    d.prepare(
      `insert into user_settings (user_id, city, lat, lon, deadline_time) values (?, ?, ?, ?, ?)
       on conflict (user_id) do update set city = excluded.city, lat = excluded.lat, lon = excluded.lon,
         deadline_time = excluded.deadline_time`,
    ).run(userId, city, lat, lon, deadline_time);
    return { ok: true };
  }

  return undefined;
}
