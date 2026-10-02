'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { temp, type Weather } from '@/lib/weather';
import { useApp } from './AppShell';
import { Icon } from './icons';

interface Place {
  name: string;
  region: string;
  lat: number;
  lon: number;
}

/** Поиск и выбор города для погоды — в настройках и на главной, пока город не задан. */
export function CityPicker({ onPicked }: { onPicked?: () => void }) {
  const { reload, toast } = useApp();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<Place[] | null>(null);
  const [busy, setBusy] = useState(false);

  const search = async (e: React.FormEvent) => {
    e.preventDefault();
    if (q.trim().length < 2) return;
    setBusy(true);
    try {
      const r = await api<{ results: Place[] }>(`settings/geocode?q=${encodeURIComponent(q.trim())}`);
      setResults(r.results);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const pick = async (p: Place) => {
    try {
      await api('settings', 'PATCH', { city: p.name, lat: p.lat, lon: p.lon });
      await reload();
      setResults(null);
      setQ('');
      onPicked?.();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <form onSubmit={search} style={{ display: 'flex', gap: 8 }}>
        <label className="sr-only" htmlFor="city-q">
          Город
        </label>
        <input id="city-q" className="field" placeholder="Город, например «Казань»" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="btn btn-ghost" type="submit" disabled={busy || q.trim().length < 2}>
          {busy ? 'Ищем…' : 'Найти'}
        </button>
      </form>
      {results && results.length === 0 && <p style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>Ничего не нашлось — проверьте название.</p>}
      {results && results.length > 0 && (
        <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {results.map((p) => (
            <li key={`${p.lat},${p.lon}`}>
              <button className="list-card" type="button" style={{ padding: '10px 14px', gap: 0 }} onClick={() => pick(p)}>
                <span style={{ fontWeight: 600 }}>{p.name}</span>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{p.region}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Карточка погоды на главной. Города нет — спрашиваем его прямо здесь. */
export function WeatherCard() {
  const { data } = useApp();
  const city = data.settings.city;
  const [w, setW] = useState<Weather | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!city) return;
    let alive = true;
    setError(null);
    api<{ weather: Weather | null }>('weather')
      .then((r) => alive && setW(r.weather))
      .catch((e: Error) => alive && setError(e.message));
    // Обновляем раз в 30 минут, пока главная открыта.
    const t = setInterval(() => api<{ weather: Weather | null }>('weather').then((r) => alive && setW(r.weather)).catch(() => {}), 30 * 60_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [city, data.settings.lat, data.settings.lon]);

  return (
    <section className="card" aria-labelledby="w-title">
      <div className="card-head">
        <h2 className="card-title display" id="w-title">
          <Icon name={w?.now.icon ?? 'cloud'} />
          Погода
        </h2>
        {city && (
          <Link className="card-link" href="/settings" style={{ color: 'var(--muted)', fontWeight: 500 }}>
            {city}
          </Link>
        )}
      </div>
      {!city ? (
        <>
          <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>Где вы? Укажите город — покажу погоду и подскажу про зонт.</p>
          <CityPicker />
        </>
      ) : error ? (
        <p style={{ margin: 0, color: 'var(--muted)' }}>{error}</p>
      ) : !w ? (
        <p style={{ margin: 0, color: 'var(--muted)' }} aria-busy="true">
          Загружаем прогноз…
        </p>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <span className="display" style={{ fontSize: 52, fontWeight: 700, lineHeight: 1 }}>
              {temp(w.now.temp)}
            </span>
            <div>
              <div style={{ fontWeight: 600 }}>{w.now.label}</div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                Ощущается как {temp(w.now.feels)} · ветер {w.now.wind} м/с
              </div>
            </div>
          </div>
          {w.hint && (
            <div className="weather-hint">
              <Icon name="drop" size={18} />
              {w.hint}
            </div>
          )}
          <div className="weather-hours">
            {w.hours.map((h) => (
              <div key={h.time}>
                <span className="mono" style={{ fontSize: 12, color: 'var(--muted)' }}>
                  {h.time}
                </span>
                <Icon name={h.icon} />
                <span className="mono" style={{ fontWeight: 500 }}>
                  {temp(h.temp)}
                </span>
              </div>
            ))}
          </div>
          <div className="weather-days">
            {w.days.map((d) => (
              <div key={d.day}>
                <span style={{ color: 'var(--muted)' }}>{d.weekday}</span>
                <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}>
                  <Icon name={d.icon} size={18} />
                  <span className="mono">
                    {temp(d.max)} / {temp(d.min)}
                  </span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
