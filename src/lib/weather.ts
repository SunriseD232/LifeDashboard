/**
 * Погода для главной. Прогноз — MET Norway (api.met.no, бесплатно, без
 * ключа, требуется подпись источника); сервер берёт его для города из
 * настроек (src/server/api/weather.ts). Open-Meteo с нашего сервера
 * недоступен, поэтому у него — только поиск городов.
 *
 * Ответ MET Norway переводим (fromMetNo) в простую форму Forecast — по часам,
 * в местном времени города, с кодами погоды WMO, — а summarize делает из неё
 * то, что нужно карточке: сейчас, по часам, на 3 дня и подсказку вроде
 * «дождь около 18:00 — возьмите зонт».
 *
 * Время в Forecast — местное для города, строками 'ГГГГ-ММ-ДДTЧЧ:ММ';
 * сравниваем их как строки.
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

// ---------------------------------------------------------------- MET Norway

interface MetNoPoint {
  time: string;
  data: {
    instant: { details: { air_temperature: number; wind_speed?: number } };
    next_1_hours?: { summary: { symbol_code: string }; details?: { precipitation_amount?: number } };
    next_6_hours?: { summary: { symbol_code: string }; details?: { precipitation_amount?: number } };
    next_12_hours?: { summary: { symbol_code: string } };
  };
}

export interface MetNo {
  properties: { timeseries: MetNoPoint[] };
}

/** Значок MET Norway («lightrainshowers_day») → код погоды WMO. */
export function symbolToWmo(symbol: string): number {
  const s = symbol.replace(/_(day|night|polartwilight)$/, '');
  if (s.includes('thunder')) return 95;
  if (s.includes('sleet')) return 66;
  if (s.includes('snowshowers')) return 85;
  if (s.includes('snow')) return s.startsWith('heavy') ? 75 : s.startsWith('light') ? 71 : 73;
  if (s.includes('rainshowers')) return 80;
  if (s.includes('rain')) return s.startsWith('heavy') ? 65 : s.startsWith('light') ? 61 : 63;
  if (s === 'fog') return 45;
  if (s === 'cloudy') return 3;
  if (s === 'partlycloudy') return 2;
  if (s === 'fair') return 1;
  if (s === 'clearsky') return 0;
  return 3;
}

/** «Ощущается как»: ветро-холодовой индекс в холод, в тепло — как есть. */
export function feelsLike(t: number, windMs: number): number {
  const v = windMs * 3.6;
  if (t > 10 || v < 4.8) return t;
  const p = Math.pow(v, 0.16);
  return 13.12 + 0.6215 * t - 11.37 * p + 0.3965 * t * p;
}

/** UTC → 'ГГГГ-ММ-ДДTЧЧ:ММ' в поясе tz. */
function localIso(utc: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(utc));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${g('year')}-${g('month')}-${g('day')}T${g('hour')}:${g('minute')}`;
}

/**
 * Ответ MET Norway → Forecast в местном времени города. Вероятности осадков
 * в бесплатном ответе нет — берём количество за час: от 0,2 мм считаем, что
 * дождь будет.
 */
export function fromMetNo(m: MetNo, tz: string): Forecast {
  const points = m.properties.timeseries;
  if (!points.length) throw new Error('пустой прогноз');
  // Почасовые точки — первые ~2,5 суток; дальше MET Norway даёт шаг 6 часов.
  const hourly = points.filter((p) => p.data.next_1_hours);
  const symbolOf = (p: MetNoPoint) =>
    (p.data.next_1_hours ?? p.data.next_6_hours ?? p.data.next_12_hours)?.summary.symbol_code ?? 'cloudy';
  const probOf = (p: MetNoPoint) => {
    const mm = p.data.next_1_hours?.details?.precipitation_amount ?? 0;
    return mm >= 0.2 ? 80 : mm > 0 ? 40 : 0;
  };

  // По дням: минимум и максимум по всем точкам, погода — ближе к полудню.
  const days = new Map<string, { min: number; max: number; code: number; noonGap: number }>();
  for (const p of points) {
    const iso = localIso(p.time, tz);
    const day = iso.slice(0, 10);
    const t = p.data.instant.details.air_temperature;
    const gap = Math.abs(Number(iso.slice(11, 13)) - 12);
    const sym = (p.data.next_6_hours ?? p.data.next_1_hours ?? p.data.next_12_hours)?.summary.symbol_code ?? 'cloudy';
    const cur = days.get(day);
    if (!cur) days.set(day, { min: t, max: t, code: symbolToWmo(sym), noonGap: gap });
    else {
      cur.min = Math.min(cur.min, t);
      cur.max = Math.max(cur.max, t);
      if (gap < cur.noonGap) Object.assign(cur, { code: symbolToWmo(sym), noonGap: gap });
    }
  }
  const dayKeys = [...days.keys()];

  const first = points[0];
  const t0 = first.data.instant.details.air_temperature;
  const w0 = first.data.instant.details.wind_speed ?? 0;
  return {
    current: {
      time: localIso(first.time, tz),
      temperature_2m: t0,
      apparent_temperature: feelsLike(t0, w0),
      weather_code: symbolToWmo(symbolOf(first)),
      wind_speed_10m: w0,
    },
    hourly: {
      time: hourly.map((p) => localIso(p.time, tz)),
      temperature_2m: hourly.map((p) => p.data.instant.details.air_temperature),
      precipitation_probability: hourly.map(probOf),
      weather_code: hourly.map((p) => symbolToWmo(symbolOf(p))),
    },
    daily: {
      time: dayKeys,
      weather_code: dayKeys.map((k) => days.get(k)!.code),
      temperature_2m_max: dayKeys.map((k) => days.get(k)!.max),
      temperature_2m_min: dayKeys.map((k) => days.get(k)!.min),
    },
  };
}
