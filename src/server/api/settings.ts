import { HttpError, text, type Ctx } from '../http';
import { readSettings } from '../settings';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

function validTz(tz: string): boolean {
  try {
    new Intl.DateTimeFormat('ru', { timeZone: tz });
    return tz.length < 64;
  } catch {
    return false;
  }
}

/**
 * Настройки человека: /api/settings и поиск города /api/settings/geocode?q=.
 * Город ищем у Open-Meteo (поиск городов), сохраняем название, координаты
 * и часовой пояс — прогноз (MET Norway) приходит в UTC.
 */
export async function settings({ d, userId, method, body, id, req }: Ctx): Promise<unknown> {
  if (method === 'GET' && id === 'geocode') {
    const q = (req.nextUrl.searchParams.get('q') ?? '').trim();
    if (q.length < 2) return { results: [] };
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q.slice(0, 80))}&count=6&language=ru&format=json`;
    let data: { results?: { name: string; admin1?: string; country?: string; latitude: number; longitude: number; timezone?: string }[] };
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
        tz: r.timezone ?? null,
      })),
    };
  }

  if (method === 'PATCH' && !id) {
    const cur = readSettings(d, userId);
    let { city, lat, lon, tz, deadline_time, summary_time } = cur;
    if (body.city !== undefined) {
      if (body.city === null) {
        city = null;
        lat = null;
        lon = null;
        tz = null;
      } else {
        city = text(body.city, 120, 'Город');
        const la = Number(body.lat);
        const lo = Number(body.lon);
        if (!Number.isFinite(la) || !Number.isFinite(lo) || Math.abs(la) > 90 || Math.abs(lo) > 180) {
          throw new HttpError(400, 'Неверные координаты города.');
        }
        lat = la;
        lon = lo;
        tz = typeof body.tz === 'string' && validTz(body.tz) ? body.tz : null;
      }
    }
    if (body.deadline_time !== undefined) {
      if (typeof body.deadline_time !== 'string' || !TIME_RE.test(body.deadline_time)) throw new HttpError(400, 'Неверное время.');
      deadline_time = body.deadline_time;
    }
    if (body.summary_time !== undefined) {
      if (body.summary_time !== null && (typeof body.summary_time !== 'string' || !TIME_RE.test(body.summary_time))) throw new HttpError(400, 'Неверное время.');
      summary_time = body.summary_time;
    }
    d.prepare(
      `insert into user_settings (user_id, city, lat, lon, tz, deadline_time, summary_time) values (?, ?, ?, ?, ?, ?, ?)
       on conflict (user_id) do update set city = excluded.city, lat = excluded.lat, lon = excluded.lon,
         tz = excluded.tz, deadline_time = excluded.deadline_time, summary_time = excluded.summary_time`,
    ).run(userId, city, lat, lon, tz, deadline_time, summary_time);
    return { ok: true };
  }

  return undefined;
}
