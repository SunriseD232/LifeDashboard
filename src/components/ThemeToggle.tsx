'use client';

import { useEffect, useState } from 'react';
import { THEMES as ORDER, THEME_COOKIE, type Theme } from '@/lib/theme';
import { Icon } from './icons';

const LABEL: Record<Theme, string> = { system: 'как в системе', light: 'светлая', dark: 'тёмная' };
const ICON: Record<Theme, string> = { system: 'monitor', light: 'sun', dark: 'moon' };

/**
 * Переключатель темы: как в системе → светлая → тёмная. Выбор — на этом
 * устройстве (кука ld_theme): на телефоне можно держать тёмную, на работе
 * светлую. Сервер читает куку в src/app/layout.tsx и сразу ставит
 * <html data-theme>, поэтому страница не мигает светлой при загрузке.
 */
export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>('system');

  useEffect(() => {
    const t = document.documentElement.dataset.theme as Theme | undefined;
    if (t && ORDER.includes(t)) setTheme(t);
  }, []);

  const next = () => {
    const t = ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length];
    setTheme(t);
    document.documentElement.dataset.theme = t;
    document.cookie = `${THEME_COOKIE}=${t}; path=/task; max-age=31536000; samesite=lax`;
  };

  const label = `Тема: ${LABEL[theme]}. Сменить`;
  return (
    <button className="icon-btn bare" type="button" onClick={next} aria-label={label} title={label}>
      <Icon name={ICON[theme]} />
    </button>
  );
}

/** Тема тремя кнопками — в Настройках (на телефоне переключателя в панели нет). */
export function ThemePicker() {
  const [theme, setTheme] = useState<Theme>('system');
  useEffect(() => {
    const t = document.documentElement.dataset.theme as Theme | undefined;
    if (t && ORDER.includes(t)) setTheme(t);
  }, []);
  const pick = (t: Theme) => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    document.cookie = `${THEME_COOKIE}=${t}; path=/task; max-age=31536000; samesite=lax`;
  };
  return (
    <div role="radiogroup" aria-label="Тема" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
      {ORDER.map((t) => (
        <button key={t} type="button" className="chip" role="radio" aria-checked={theme === t} aria-pressed={theme === t} onClick={() => pick(t)}>
          <Icon name={ICON[t]} size={16} />
          {LABEL[t].charAt(0).toUpperCase() + LABEL[t].slice(1)}
        </button>
      ))}
    </div>
  );
}
