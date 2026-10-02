/**
 * Погода для главной — из Open-Meteo (бесплатно, без ключа). Сервер берёт
 * прогноз для города из настроек (src/server/api/weather.ts), а здесь —
 * разбор ответа в то, что нужно карточке: сейчас, по часам, на 3 дня и
 * подсказка вроде «дождь около 18:00 — возьмите зонт».
 *
 * Время в ответе — местное для города (timezone=auto), строками
 * 'ГГГГ-ММ-ДДTЧЧ:ММ'; сравниваем их как строки.
 */

export type WeatherIcon = 'sun' | 'partly' | 'cloud' | 'fog' | 'rain' | 'snow' | 'storm';

export interface Forecast {
  current: { time: string; temperature_2m: number; apparent_temperature: number; weather_code: number; wind_speed_10m: number };
  hourly: { time: string[]; temperature_2m: number[]; precipitation_probability: (number | null)[]; weather_code: number[] };
  daily: { time: string[]; weather_code: number[]; temperature_2m_max: number[]; temperature_2m_min: number[] };
}

export interface Weather {
  city: string;
  now: { temp: number; feels: number; label: string; icon: WeatherIcon; wind: number };
  hours: { time: string; temp: number; icon: WeatherIcon }[];
  days: { day: string; weekday: string; min: number; max: number; icon: WeatherIcon }[];
  hint: string | null;
}

/** Коды погоды WMO → подпись и значок. */
export function describeCode(code: number): { label: string; icon: WeatherIcon } {
  if (code === 0) return { label: 'Ясно', icon: 'sun' };
  if (code === 1) return { label: 'Малооблачно', icon: 'partly' };
  if (code === 2) return { label: 'Переменная облачность', icon: 'partly' };
  if (code === 3) return { label: 'Пасмурно', icon: 'cloud' };
  if (code === 45 || code === 48) return { label: 'Туман', icon: 'fog' };
  if (code >= 51 && code <= 57) return { label: 'Морось', icon: 'rain' };
  if (code >= 61 && code <= 67) return { label: code >= 66 ? 'Ледяной дождь' : 'Дождь', icon: 'rain' };
  if (code >= 71 && code <= 77) return { label: 'Снег', icon: 'snow' };
  if (code >= 80 && code <= 82) return { label: 'Ливень', icon: 'rain' };
  if (code === 85 || code === 86) return { label: 'Снегопад', icon: 'snow' };
  if (code >= 95) return { label: 'Гроза', icon: 'storm' };
  return { label: 'Облачно', icon: 'cloud' };
}

const WEEKDAYS = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'];
const RAIN_PROB = 50;

function wet(code: number): 'rain' | 'snow' | 'storm' | null {
  const { icon } = describeCode(code);
  return icon === 'rain' || icon === 'snow' || icon === 'storm' ? icon : null;
}

/** Подсказка на ближайшие 12 часов: осадки сейчас или когда начнутся. */
export function hint(f: Forecast): string | null {
  const nowWet = wet(f.current.weather_code);
  if (nowWet) return nowWet === 'snow' ? 'Сейчас идёт снег — одевайтесь теплее' : 'Сейчас дождь — возьмите зонт';
  const nowHour = f.current.time.slice(0, 13);
  const start = f.hourly.time.findIndex((t) => t.slice(0, 13) >= nowHour);
  if (start < 0) return null;
  for (let i = start + 1; i < Math.min(f.hourly.time.length, start + 13); i++) {
    const kind = wet(f.hourly.weather_code[i]);
    const prob = f.hourly.precipitation_probability[i] ?? 0;
    if (kind && prob >= RAIN_PROB) {
      const at = f.hourly.time[i].slice(11, 16);
      if (kind === 'snow') return `Снег около ${at}`;
      if (kind === 'storm') return `Гроза около ${at} — лучше переждать дома`;
      return `Дождь около ${at} — возьмите зонт`;
    }
  }
  return null;
}

export function summarize(f: Forecast, city: string): Weather {
  const nowHour = f.current.time.slice(0, 13);
  const start = Math.max(0, f.hourly.time.findIndex((t) => t.slice(0, 13) >= nowHour));
  const hours: Weather['hours'] = [];
  // Каждые 3 часа начиная со следующего — пять отметок.
  for (let i = start + 3; i < f.hourly.time.length && hours.length < 5; i += 3) {
    hours.push({
      time: f.hourly.time[i].slice(11, 16),
      temp: Math.round(f.hourly.temperature_2m[i]),
      icon: describeCode(f.hourly.weather_code[i]).icon,
    });
  }
  const today = f.current.time.slice(0, 10);
  const days = f.daily.time
    .map((day, i) => ({ day, i }))
    .filter(({ day }) => day > today)
    .slice(0, 3)
    .map(({ day, i }) => ({
      day,
      weekday: WEEKDAYS[new Date(`${day}T00:00:00Z`).getUTCDay()],
      min: Math.round(f.daily.temperature_2m_min[i]),
      max: Math.round(f.daily.temperature_2m_max[i]),
      icon: describeCode(f.daily.weather_code[i]).icon,
    }));
  const d = describeCode(f.current.weather_code);
  return {
    city,
    now: {
      temp: Math.round(f.current.temperature_2m),
      feels: Math.round(f.current.apparent_temperature),
      label: d.label,
      icon: d.icon,
      wind: Math.round(f.current.wind_speed_10m),
    },
    hours,
    days,
    hint: hint(f),
  };
}

/** «+11°», «−3°», «0°». */
export function temp(n: number): string {
  return n > 0 ? `+${n}°` : n < 0 ? `−${-n}°` : '0°';
}
