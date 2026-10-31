'use client';

import { useEffect, useRef, useState, type RefObject } from 'react';

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
/** Куда ставить фокус при открытии: первое видимое поле для ввода (не галочка). */
const FIRST_FIELD = 'input:not([disabled]):not([type="hidden"]):not([type="file"]):not([type="checkbox"]):not([type="radio"]), textarea:not([disabled]), select:not([disabled])';

// Открытые окна по порядку: Tab и Esc достаются только верхнему, иначе один
// Esc закрыл бы и подтверждение, и окно задачи под ним вместе с правками.
const stack: object[] = [];

/**
 * Фокус в модальном окне: Tab и Shift+Tab ходят по кругу внутри окна, Esc
 * закрывает только верхнее окно, а после закрытия фокус возвращается туда,
 * откуда окно открыли — с клавиатуры и экранным диктором не теряешь, где был.
 */
export function useModalFocus(ref: RefObject<HTMLElement>, onEscape?: () => void, active = true): void {
  // Запоминаем при первом рендере: к эффекту autoFocus внутри окна уже
  // перетянул фокус на себя, и «вернуть» было бы некуда.
  const [opener] = useState(() => (typeof document === 'undefined' ? null : (document.activeElement as HTMLElement | null)));
  const esc = useRef(onEscape);
  esc.current = onEscape;

  useEffect(() => {
    if (!active) return;
    const me = {};
    const node = ref.current;
    stack.push(me);
    const onKey = (e: KeyboardEvent) => {
      if (stack[stack.length - 1] !== me || !ref.current) return;
      if (e.key === 'Escape') {
        if (!esc.current || e.defaultPrevented) return;
        e.preventDefault();
        e.stopImmediatePropagation();
        esc.current();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.getClientRects().length > 0);
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      } else if (!ref.current.contains(document.activeElement)) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      const i = stack.indexOf(me);
      if (i >= 0) stack.splice(i, 1);
      // Окно ещё в документе — это повторный запуск эффекта (строгий режим),
      // а не закрытие. Окно могли закрыть переходом на другую страницу —
      // тогда возвращать некуда.
      // Фокус уже стоит в другом живом окне — не отнимаем.
      queueMicrotask(() => {
        if (node?.isConnected) return;
        const now = document.activeElement;
        if (now && now !== document.body && now.isConnected && !node?.contains(now)) return;
        if (opener && opener !== document.body && opener.isConnected) opener.focus();
      });
    };
  }, [ref, opener, active]);
}

/** Поставить фокус в окно, если его там ещё нет: в первое поле или в само окно. */
export function focusInto(box: HTMLElement | null, field: boolean): void {
  if (!box || box.contains(document.activeElement)) return;
  // Видимое: в шапке бывает свёрнутое меню со своими полями.
  const target = field ? [...box.querySelectorAll<HTMLElement>(FIRST_FIELD)].find((el) => el.getClientRects().length > 0) : null;
  if (target) return target.focus();
  // Само окно — диктор прочтёт заголовок, а на телефоне не выскочит клавиатура.
  if (!box.hasAttribute('tabindex')) box.tabIndex = -1;
  box.focus();
}

/**
 * Нижнее окно целиком: фокус по кругу, Esc, фокус в окне и страница под ним
 * не прокручивается. canClose — пока идёт запись или распознавание, Esc
 * ничего не делает, как и тап мимо.
 */
export function useSheet(ref: RefObject<HTMLElement>, onClose: () => void, canClose = true): void {
  useModalFocus(ref, canClose ? onClose : undefined);
  useEffect(() => {
    focusInto(ref.current, false);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, [ref]);
}
