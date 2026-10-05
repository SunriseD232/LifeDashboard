'use client';

import { useEffect, useState } from 'react';
import { ACCENT_COOKIE, ACCENTS, isAccent, isSize, saveCookie, SIZE_COOKIE, SIZES, THEMES as ORDER, THEME_COOKIE, type Accent, type Size, type Theme } from '@/lib/theme';
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
    saveCookie(THEME_COOKIE, t);
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
    saveCookie(THEME_COOKIE, t);
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

/**
 * Оформление в Настройках: тема, акцентный цвет и размер текста. Всё — на
 * этом устройстве (куки), применяется сразу.
 */
export function AppearancePicker() {
  const [accent, setAccent] = useState<Accent>('teal');
  const [size, setSize] = useState<Size>('md');
  useEffect(() => {
    const a = document.documentElement.dataset.accent;
    const s = document.documentElement.dataset.size;
    setAccent(isAccent(a) ? a : 'teal');
    setSize(isSize(s) ? s : 'md');
  }, []);
  const pickAccent = (a: Accent) => {
    setAccent(a);
    if (a === 'teal') delete document.documentElement.dataset.accent;
    else document.documentElement.dataset.accent = a;
    saveCookie(ACCENT_COOKIE, a);
  };
  const pickSize = (s: Size) => {
    setSize(s);
    if (s === 'md') delete document.documentElement.dataset.size;
    else document.documentElement.dataset.size = s;
    saveCookie(SIZE_COOKIE, s);
  };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div className="fld">
        <span className="label">Тема</span>
        <ThemePicker />
      </div>
      <div className="fld">
        <span className="label" id="accent-label">
          Цвет акцента
        </span>
        <div className="swatches" role="radiogroup" aria-labelledby="accent-label">
          {ACCENTS.map((a) => (
            <button key={a.id} type="button" className="swatch" role="radio" aria-checked={accent === a.id} aria-label={a.label} title={a.label} style={{ background: a.color }} onClick={() => pickAccent(a.id)}>
              {accent === a.id && <Icon name="check" size={18} strokeWidth={2.4} />}
            </button>
          ))}
        </div>
      </div>
      <div className="fld">
        <span className="label" id="size-label">
          Размер текста
        </span>
        <div className="seg seg-4" role="radiogroup" aria-labelledby="size-label">
          {SIZES.map((s) => (
            <button key={s.id} type="button" role="radio" aria-checked={size === s.id} aria-pressed={size === s.id} onClick={() => pickSize(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>
      <div className="appearance-preview" aria-hidden="true">
        <span className="check round done" style={{ padding: 0, minHeight: 0 }}>
          <input type="checkbox" checked readOnly tabIndex={-1} />
          <span className="check-text">Так выглядит отмеченная задача</span>
        </span>
        <button className="btn btn-primary" type="button" tabIndex={-1}>
          Кнопка
        </button>
      </div>
    </div>
  );
}
