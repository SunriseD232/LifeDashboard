import type { KeyboardEvent } from 'react';

const STEP: Record<string, number> = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };

/**
 * Стрелки в группе радиокнопок или вкладок — как в нативной группе: Tab
 * заходит в группу одной остановкой (на выбранный пункт, у остальных
 * tabIndex -1), стрелки, Home и End двигают и фокус, и выбор. Вешать на
 * контейнер с role="radiogroup" или role="tablist".
 */
export function rovingKeys(e: KeyboardEvent<HTMLElement>): void {
  const step = STEP[e.key];
  if (!step && e.key !== 'Home' && e.key !== 'End') return;
  const items = [...e.currentTarget.querySelectorAll<HTMLElement>('[role="radio"]:not([disabled]), [role="tab"]:not([disabled])')];
  const i = items.indexOf(e.target as HTMLElement);
  if (i < 0 || !items.length) return;
  e.preventDefault();
  const next = e.key === 'Home' ? items[0] : e.key === 'End' ? items[items.length - 1] : items[(i + step + items.length) % items.length];
  next.focus();
  next.click();
}
