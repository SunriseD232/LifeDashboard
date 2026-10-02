import { describe, expect, it } from 'vitest';
import { describeCode, hint, summarize, temp, type Forecast } from '../weather';

function forecast(over: { codes?: number[]; probs?: number[]; nowCode?: number } = {}): Forecast {
  const time = Array.from({ length: 48 }, (_, h) => `2026-10-${h < 24 ? '02' : '03'}T${String(h % 24).padStart(2, '0')}:00`);
  return {
    current: { time: '2026-10-02T12:15', temperature_2m: 10.6, apparent_temperature: 7.6, weather_code: over.nowCode ?? 3, wind_speed_10m: 4.4 },
    hourly: {
      time,
      temperature_2m: time.map((_, i) => 5 + (i % 24) / 2),
      precipitation_probability: over.probs ?? time.map(() => 0),
      weather_code: over.codes ?? time.map(() => 3),
    },
    daily: {
      time: ['2026-10-02', '2026-10-03', '2026-10-04', '2026-10-05', '2026-10-06'],
      weather_code: [3, 61, 0, 2, 71],
      temperature_2m_max: [12, 9.4, 13, 12, 3],
      temperature_2m_min: [5, 4, 5, 6, -2.6],
    },
  };
}

describe('weather', () => {
  it('коды погоды', () => {
    expect(describeCode(0)).toEqual({ label: 'Ясно', icon: 'sun' });
    expect(describeCode(63).icon).toBe('rain');
    expect(describeCode(75).icon).toBe('snow');
    expect(describeCode(95).icon).toBe('storm');
  });

  it('сводка: сейчас, каждые 3 часа, три следующих дня', () => {
    const w = summarize(forecast(), 'Москва');
    expect(w.now).toEqual({ temp: 11, feels: 8, label: 'Пасмурно', icon: 'cloud', wind: 4 });
    expect(w.hours.map((h) => h.time)).toEqual(['15:00', '18:00', '21:00', '00:00', '03:00']);
    expect(w.days.map((d) => [d.weekday, d.min, d.max, d.icon])).toEqual([
      ['Сб', 4, 9, 'rain'],
      ['Вс', 5, 13, 'sun'],
      ['Пн', 6, 12, 'partly'],
    ]);
  });

  it('зонт: дождь с вероятностью ≥ 50% в ближайшие 12 часов', () => {
    const codes = Array(48).fill(3);
    const probs = Array(48).fill(0);
    codes[18] = 61;
    probs[18] = 70;
    expect(hint(forecast({ codes, probs }))).toBe('Дождь около 18:00 — возьмите зонт');
    probs[18] = 30;
    expect(hint(forecast({ codes, probs }))).toBeNull();
  });

  it('дождь уже идёт', () => {
    expect(hint(forecast({ nowCode: 63 }))).toBe('Сейчас дождь — возьмите зонт');
  });

  it('знак температуры', () => {
    expect([temp(11), temp(-3), temp(0)]).toEqual(['+11°', '−3°', '0°']);
  });
});
