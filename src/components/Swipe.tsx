'use client';

import { useEffect, useRef, useState } from 'react';
import { Icon } from './icons';

export interface SwipeAction {
  label: string;
  icon: string;
  tone?: 'danger' | 'warm';
  onClick: () => void;
}

const DONE_AT = 80;
const ACTION_W = 76;

/**
 * Свайп строки пальцем, как в Apple Напоминаниях: вправо — «Сделано»
 * (onRight), влево — открываются кнопки действий. Только касание: мышь и
 * прокрутка страницы не задевают (направление решаем по первым пикселям).
 * Всё то же есть и кнопками — свайп лишь короче.
 */
export default function Swipe({
  children,
  onRight,
  rightLabel = 'Сделано',
  rightIcon = 'check',
  actions = [],
}: {
  children: React.ReactNode;
  onRight?: () => void;
  rightLabel?: string;
  rightIcon?: string;
  actions?: SwipeAction[];
}) {
  const [dx, setDxState] = useState(0);
  // Последнее смещение — в ref: отпускание читает его без ожидания перерисовки.
  const dxRef = useRef(0);
  const setDx = (v: number) => {
    dxRef.current = v;
    setDxState(v);
  };
  const [openLeft, setOpenLeft] = useState(false);
  const [dragging, setDragging] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  // Тянули ли строку в этом касании — тогда следующий click не считается нажатием.
  const moved = useRef(false);
  const start = useRef<{ x: number; y: number; base: number; axis: 'x' | 'y' | null } | null>(null);
  const width = actions.length * ACTION_W;

  // Тап мимо открытых кнопок — закрыть.
  useEffect(() => {
    if (!openLeft) return;
    const close = (e: PointerEvent) => {
      if (!box.current?.contains(e.target as Node)) {
        setOpenLeft(false);
        setDx(0);
      }
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, [openLeft]);

  const down = (e: React.PointerEvent) => {
    if (e.pointerType === 'mouse') return;
    moved.current = false;
    start.current = { x: e.clientX, y: e.clientY, base: openLeft ? -width : 0, axis: null };
  };
  const move = (e: React.PointerEvent) => {
    const s = start.current;
    if (!s) return;
    const mx = e.clientX - s.x;
    const my = e.clientY - s.y;
    if (!s.axis) {
      if (Math.abs(mx) < 8 && Math.abs(my) < 8) return;
      s.axis = Math.abs(mx) > Math.abs(my) ? 'x' : 'y';
      if (s.axis === 'x') {
        moved.current = true;
        setDragging(true);
        try {
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        } catch {
          /* без захвата тоже работает, пока палец над строкой */
        }
      }
    }
    if (s.axis !== 'x') return;
    let next = s.base + mx;
    if (!onRight) next = Math.min(0, next);
    if (!actions.length) next = Math.max(0, next);
    setDx(Math.max(-width - 24, Math.min(DONE_AT + 40, next)));
  };
  const up = () => {
    const s = start.current;
    start.current = null;
    if (!s || s.axis !== 'x') return;
    setDragging(false);
    const dx = dxRef.current;
    if (dx >= DONE_AT && onRight) {
      onRight();
      setDx(0);
      setOpenLeft(false);
      return;
    }
    const open = dx < -width / 2;
    setOpenLeft(open);
    setDx(open ? -width : 0);
  };

  return (
    <div ref={box} className="swipe">
      {onRight && (
        <div className="swipe-under swipe-right" aria-hidden="true" style={{ opacity: dx > 0 ? Math.min(1, dx / DONE_AT) : 0 }}>
          <Icon name={rightIcon} size={20} />
          {rightLabel}
        </div>
      )}
      {actions.length > 0 && (
        <div className="swipe-under swipe-left" style={{ width, visibility: dx < 0 ? 'visible' : 'hidden' }}>
          {actions.map((a) => (
            <button
              key={a.label}
              type="button"
              className="swipe-btn"
              data-tone={a.tone}
              tabIndex={openLeft ? 0 : -1}
              onClick={() => {
                setOpenLeft(false);
                setDx(0);
                a.onClick();
              }}
            >
              <Icon name={a.icon} size={20} />
              {a.label}
            </button>
          ))}
        </div>
      )}
      <div
        className="swipe-row"
        style={{ transform: dx ? `translateX(${dx}px)` : undefined, transition: dragging ? 'none' : undefined }}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        onClickCapture={(e) => {
          // Палец только что тянул строку — это не нажатие на галочку.
          if (moved.current || openLeft) {
            moved.current = false;
            e.preventDefault();
            e.stopPropagation();
            if (openLeft) {
              setOpenLeft(false);
              setDx(0);
            }
          }
        }}
      >
        {children}
      </div>
    </div>
  );
}
