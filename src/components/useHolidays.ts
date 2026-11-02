'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { Holiday } from '@/lib/holidays';
import { useApp } from './AppShell';

// Год страны грузится один раз на вкладку: календари листают месяцы туда-сюда.
const cache = new Map<string, Map<string, Holiday>>();
const loading = new Map<string, Promise<void>>();

function load(country: string, year: number): Promise<void> {
  const key = `${country}-${year}`;
  if (cache.has(key)) return Promise.resolve();
  let p = loading.get(key);
  if (!p) {
    p = api<{ days: Holiday[] }>(`holidays/${year}?country=${country}`)
      .then((r) => {
        cache.set(key, new Map(r.days.map((h) => [h.day, h])));
      })
      .catch(() => undefined)
      .finally(() => loading.delete(key));
    loading.set(key, p);
  }
  return p;
}

/**
 * Праздник в этот день по стране из настроек — или null. Праздники выключены —
 * всегда null. years — какие годы видны на экране (догружаются сами).
 */
export function useHolidays(years: number[]): ((day: string) => Holiday | null) | null {
  const { data } = useApp();
  const on = data.settings.holidays_on ?? true;
  const country = data.settings.holiday_country ?? 'RU';
  const [, bump] = useState(0);
  const want = [...new Set(years)].filter((y) => !cache.has(`${country}-${y}`));
  const wantKey = want.join(',');
  useEffect(() => {
    if (!on || !wantKey) return;
    let alive = true;
    Promise.all(wantKey.split(',').map((y) => load(country, Number(y)))).then(() => alive && bump((n) => n + 1));
    return () => {
      alive = false;
    };
  }, [on, country, wantKey]);
  if (!on) return null;
  return (day) => cache.get(`${country}-${day.slice(0, 4)}`)?.get(day) ?? null;
}
