import { describe, expect, it } from 'vitest';
import { feelsLike, fromMetNo, summarize, symbolToWmo, type MetNo } from '../weather';

/** Почасовые точки с 12:00 UTC 2 октября; в 18 UTC (21:00 Москвы) — дождь. */
function sample(): MetNo {
  const timeseries = Array.from({ length: 30 }, (_, i) => {
    const t = new Date(Date.UTC(2026, 9, 2, 12 + i));
    const rain = i === 6;
    return {
      time: t.toISOString().replace('.000', ''),
      data: {
        instant: { details: { air_temperature: 10 + (i % 5), wind_speed: 3 } },
        next_1_hours: { summary: { symbol_code: rain ? 'rain' : 'cloudy' }, details: { precipitation_amount: rain ? 1.2 : 0 } },
        next_6_hours: { summary: { symbol_code: 'partlycloudy_day' }, details: { precipitation_amount: 0 } },
      },
    };
  });
  return { properties: { timeseries } };
}

describe('MET Norway', () => {
  it('значки → коды WMO', () => {
    expect(symbolToWmo('clearsky_day')).toBe(0);
    expect(symbolToWmo('partlycloudy_night')).toBe(2);
    expect(symbolToWmo('lightrainshowers_day')).toBe(80);
    expect(symbolToWmo('heavyrain')).toBe(65);
    expect(symbolToWmo('lightsnow')).toBe(71);
    expect(symbolToWmo('rainandthunder')).toBe(95);
    expect(symbolToWmo('sleet')).toBe(66);
    expect(symbolToWmo('fog')).toBe(45);
  });

  it('время — местное для города, дождь попадает в подсказку', () => {
    const f = fromMetNo(sample(), 'Europe/Moscow');
    expect(f.current.time).toBe('2026-10-02T15:00');
    expect(f.hourly.time[6]).toBe('2026-10-02T21:00');
    const w = summarize(f, 'Москва');
    expect(w.hint).toBe('Дождь около 21:00 — возьмите зонт');
    expect(w.now.temp).toBe(10);
  });

  it('дни — по местной дате, мин и макс', () => {
    const f = fromMetNo(sample(), 'Europe/Moscow');
    expect(f.daily.time).toEqual(['2026-10-02', '2026-10-03']);
    expect(f.daily.temperature_2m_min[1]).toBe(10);
    expect(f.daily.temperature_2m_max[1]).toBe(14);
  });

  it('«ощущается»: в холод с ветром ниже, в тепло как есть', () => {
    expect(feelsLike(20, 5)).toBe(20);
    expect(Math.round(feelsLike(0, 5))).toBe(-5);
  });
});
