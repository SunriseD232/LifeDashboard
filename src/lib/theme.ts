/**
 * Оформление: выбор на устройстве (куки), см. src/components/ThemeToggle.tsx.
 * Сервер читает куки в src/app/layout.tsx и сразу ставит атрибуты на <html> —
 * страница не мигает чужими цветами при загрузке.
 */
export type Theme = 'system' | 'light' | 'dark';

export const THEMES: Theme[] = ['system', 'light', 'dark'];
export const THEME_COOKIE = 'ld_theme';

/** Акцентный цвет: кнопки, отметки, выбранное. Цвета — в globals.css. */
export const ACCENTS = [
  { id: 'teal', label: 'Бирюза', color: '#0e7c7b' },
  { id: 'blue', label: 'Синий', color: '#2557c7' },
  { id: 'violet', label: 'Фиолетовый', color: '#6d43c9' },
  { id: 'rose', label: 'Малиновый', color: '#c0306a' },
  { id: 'orange', label: 'Оранжевый', color: '#b4530a' },
  { id: 'green', label: 'Зелёный', color: '#2f7d32' },
  { id: 'graphite', label: 'Графит', color: '#3f4a56' },
] as const;
export type Accent = (typeof ACCENTS)[number]['id'];
export const ACCENT_COOKIE = 'ld_accent';

/** Размер текста: множитель --fs у всех font-size. */
export const SIZES = [
  { id: 'sm', label: 'Мельче' },
  { id: 'md', label: 'Обычный' },
  { id: 'lg', label: 'Крупнее' },
  { id: 'xl', label: 'Крупный' },
] as const;
export type Size = (typeof SIZES)[number]['id'];
export const SIZE_COOKIE = 'ld_size';

export const isAccent = (v: unknown): v is Accent => ACCENTS.some((a) => a.id === v);
export const isSize = (v: unknown): v is Size => SIZES.some((s) => s.id === v);

/** Запомнить выбор на этом устройстве на год. */
export function saveCookie(name: string, value: string): void {
  document.cookie = `${name}=${value}; path=/task; max-age=31536000; samesite=lax`;
}
