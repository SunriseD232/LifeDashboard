'use client';

import { useEffect } from 'react';

/**
 * Экранная клавиатура на телефоне: её высоту кладём в --kb, а при открытой
 * клавиатуре ставим класс kb-open на <html>. Нижние панели по CSS встают над
 * ней, а не уезжают под неё вместе с прокруткой страницы.
 */
export function useKeyboardOffset(): void {
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const kb = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
      root.style.setProperty('--kb', `${kb}px`);
      root.classList.toggle('kb-open', kb > 80);
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--kb');
      root.classList.remove('kb-open');
    };
  }, []);
}
