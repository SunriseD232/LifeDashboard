'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Icon } from './icons';
import { focusInto, useModalFocus } from './useModalFocus';

/**
 * Телефонный вид: на узком экране — только список, а формы открываются
 * круглой кнопкой «+» в окне снизу. На компьютере всё как было.
 */

const PHONE = '(max-width: 860px)';

export function useIsPhone(): boolean {
  const [phone, setPhone] = useState(() => typeof window !== 'undefined' && window.matchMedia(PHONE).matches);
  useEffect(() => {
    const mq = window.matchMedia(PHONE);
    const on = () => setPhone(mq.matches);
    on();
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return phone;
}

/**
 * Круглая «+» над нижней панелью. Рисуем прямо в body: экран при переходе
 * едет через transform, и fixed внутри него сначала стоял бы не на месте.
 */
export function Fab({ label, onClick }: { label: string; onClick: () => void }) {
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  if (!ready) return null;
  return createPortal(
    <button className="fab" type="button" aria-label={label} title={label} onClick={onClick}>
      <Icon name="plus" size={26} strokeWidth={2.2} />
    </button>,
    document.body,
  );
}

/** Окно снизу: заголовок, крестик, содержимое; Esc и тап мимо — закрыть. */
export function Sheet({ title, onClose, children, actions }: { title: string; onClose: () => void; children: React.ReactNode; actions?: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useModalFocus(ref, onClose);
  // Один раз при открытии: onClose у родителя часто новый на каждый рендер,
  // и эффект с ним в зависимостях перескакивал бы курсором на первое поле.
  useEffect(() => {
    focusInto(ref.current, true);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);
  return (
    <div className="sheet-scrim" onClick={onClose}>
      <div ref={ref} className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <h2 className="display" style={{ margin: 0, fontSize: 'calc(19px * var(--fs))', flex: 1 }}>
            {title}
          </h2>
          {actions}
          <button className="icon-btn bare" type="button" aria-label="Закрыть" onClick={onClose}>
            <Icon name="x" size={20} />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

/**
 * Форма: на компьютере — на месте, на телефоне — за кнопкой «+» в окне
 * снизу. render получает done(): вызвать после сохранения, чтобы закрыть.
 */
export function PhoneForm({ title, fab, render }: { title: string; fab: string; render: (done: () => void, inSheet: boolean) => React.ReactNode }) {
  const phone = useIsPhone();
  const [open, setOpen] = useState(false);
  if (!phone) return <>{render(() => undefined, false)}</>;
  return (
    <>
      <Fab label={fab} onClick={() => setOpen(true)} />
      {open && (
        <Sheet title={title} onClose={() => setOpen(false)}>
          {render(() => setOpen(false), true)}
        </Sheet>
      )}
    </>
  );
}
