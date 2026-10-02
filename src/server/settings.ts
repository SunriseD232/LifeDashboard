import type Database from 'better-sqlite3';

export interface Settings {
  city: string | null;
  lat: number | null;
  lon: number | null;
  /** Часовой пояс города (IANA) — прогноз приходит в UTC. */
  tz: string | null;
  /** Во сколько напоминать о сроках дел (за день и в день срока), 'ЧЧ:ММ'. */
  deadline_time: string;
  /** Утренняя сводка ИИ в push: во сколько, или null — выключена. */
  summary_time: string | null;
}

export const DEFAULT_SETTINGS: Settings = { city: null, lat: null, lon: null, tz: null, deadline_time: '09:00', summary_time: null };

export function readSettings(d: Database.Database, userId: string): Settings {
  const row = d.prepare('select city, lat, lon, tz, deadline_time, summary_time from user_settings where user_id = ?').get(userId) as
    | Settings
    | undefined;
  return row ?? { ...DEFAULT_SETTINGS };
}
