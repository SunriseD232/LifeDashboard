import type Database from 'better-sqlite3';
import { parseNav, type NavPref } from '@/lib/nav';

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
  /** Свой порядок и скрытые разделы меню; null — как по умолчанию. */
  nav: NavPref[] | null;
  /** Секрет ссылки-подписки на календарь; null — не включали. */
  calendar_token: string | null;
  /** Прошёл знакомство при первом входе. */
  onboarded: boolean;
  /** Тихие часы: с — до, 'ЧЧ:ММ'; null — выключены. */
  quiet_from: string | null;
  quiet_to: string | null;
  /** Итог дня вечером: во сколько; null — выключен. */
  review_time: string | null;
}

export const DEFAULT_SETTINGS: Settings = { city: null, lat: null, lon: null, tz: null, deadline_time: '09:00', summary_time: null, nav: null, calendar_token: null, onboarded: false, quiet_from: '23:00', quiet_to: '07:00', review_time: null };

export function readSettings(d: Database.Database, userId: string): Settings {
  const row = d.prepare('select city, lat, lon, tz, deadline_time, summary_time, nav, calendar_token, onboarded, quiet_from, quiet_to, review_time from user_settings where user_id = ?').get(userId) as
    | (Omit<Settings, 'nav' | 'onboarded'> & { nav: string | null; onboarded: number })
    | undefined;
  if (!row) return { ...DEFAULT_SETTINGS };
  let nav: NavPref[] | null = null;
  try {
    nav = row.nav ? parseNav(JSON.parse(row.nav)) : null;
  } catch {
    nav = null;
  }
  return { ...row, nav, onboarded: !!row.onboarded };
}
