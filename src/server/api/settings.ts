import { HttpError, text, type Ctx } from '../http';
import { randomBytes } from 'node:crypto';
import { parseNav } from '@/lib/nav';
import { cleanList, readSettings, TASK_FIELDS } from '../settings';

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
    let { city, lat, lon, tz, deadline_time, summary_time, nav, calendar_token, onboarded, quiet_from, quiet_to, review_time } = cur;
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
    const timeOrNull = (v: unknown): string | null => {
      if (v !== null && (typeof v !== 'string' || !TIME_RE.test(v))) throw new HttpError(400, 'Неверное время.');
      return v as string | null;
    };
    if (body.onboarded !== undefined) onboarded = !!body.onboarded;
    // Тихие часы: оба времени или оба null.
    if (body.quiet_from !== undefined || body.quiet_to !== undefined) {
      const f = timeOrNull(body.quiet_from ?? null);
      const t = timeOrNull(body.quiet_to ?? null);
      if ((f === null) !== (t === null) || (f !== null && f === t)) throw new HttpError(400, 'Укажите, с какого и до какого времени.');
      quiet_from = f;
      quiet_to = t;
    }
    if (body.review_time !== undefined) review_time = timeOrNull(body.review_time);
    if (body.nav !== undefined) nav = body.nav === null ? null : parseNav(body.nav);
    // Календарь: true — выдать (или перевыпустить) ссылку, false — отключить.
    if (body.calendar !== undefined) calendar_token = body.calendar ? randomBytes(24).toString('base64url') : null;
    d.prepare(
      `insert into user_settings (user_id, city, lat, lon, tz, deadline_time, summary_time, nav, calendar_token, onboarded, quiet_from, quiet_to, review_time)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       on conflict (user_id) do update set city = excluded.city, lat = excluded.lat, lon = excluded.lon,
         tz = excluded.tz, deadline_time = excluded.deadline_time, summary_time = excluded.summary_time,
         nav = excluded.nav, calendar_token = excluded.calendar_token, onboarded = excluded.onboarded,
         quiet_from = excluded.quiet_from, quiet_to = excluded.quiet_to, review_time = excluded.review_time`,
    ).run(userId, city, lat, lon, tz, deadline_time, summary_time, nav ? JSON.stringify(nav) : null, calendar_token, onboarded ? 1 : 0, quiet_from, quiet_to, review_time);
    // Списки — строкой JSON; неизвестное отбрасываем.
    if (body.tour_seen !== undefined) d.prepare('update user_settings set tour_seen = ? where user_id = ?').run(JSON.stringify(cleanList(JSON.stringify(body.tour_seen))), userId);
    if (body.task_hidden !== undefined) d.prepare('update user_settings set task_hidden = ? where user_id = ?').run(JSON.stringify(cleanList(JSON.stringify(body.task_hidden), TASK_FIELDS)), userId);
    return { ok: true };
  }

  return undefined;
}
