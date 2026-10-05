'use client';

import { useEffect, useRef } from 'react';
import { Icon } from './icons';
import { useModalFocus } from './useModalFocus';

/** Подтверждение необратимого действия. Esc и клик мимо — «Оставить». */
export default function Confirm({
  title,
  text,
  action,
  onConfirm,
  onCancel,
}: {
  title: string;
  text: string;
  action: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const cancelRef = useRef<HTMLButtonElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useModalFocus(boxRef);

  useEffect(() => {
    // Фокус на безопасной кнопке: случайный Enter ничего не удалит.
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div className="overlay" onClick={onCancel}>
      <div
        ref={boxRef}
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        aria-describedby="confirm-text"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="confirm-title" className="display" style={{ margin: 0, fontSize: 'calc(19px * var(--fs))' }}>
          {title}
        </h2>
        <p id="confirm-text" style={{ margin: 0, color: 'var(--muted)', fontSize: 'calc(14px * var(--fs))' }}>
          {text}
        </p>
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button ref={cancelRef} className="btn btn-ghost" type="button" onClick={onCancel}>
            Оставить
          </button>
          <button className="btn btn-danger" type="button" onClick={onConfirm}>
            <Icon name="trash" size={18} />
            {action}
          </button>
        </div>
      </div>
    </div>
  );
}
