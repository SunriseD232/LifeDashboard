import type Database from 'better-sqlite3';

export interface Settings {
  city: string | null;
  lat: number | null;
  lon: number | null;
  /** Часовой пояс города (IANA) — прогноз приходит в UTC. */
  tz: string | null;
  /** Во сколько напоминать о сроках дел (за день и в день срока), 'ЧЧ:ММ'. */
  deadline_time: string;
}

export const DEFAULT_SETTINGS: Settings = { city: null, lat: null, lon: null, tz: null, deadline_time: '09:00' };

export function readSettings(d: Database.Database, userId: string): Settings {
  const row = d.prepare('select city, lat, lon, tz, deadline_time from user_settings where user_id = ?').get(userId) as
    | Settings
    | undefined;
  return row ?? { ...DEFAULT_SETTINGS };
}
