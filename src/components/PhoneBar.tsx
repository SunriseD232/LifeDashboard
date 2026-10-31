'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { activeIndex, wasPop, type BarItem, type Context } from '@/lib/superapp';
import { Icon } from './icons';

/**
 * Нижнее меню супер-аппа на телефоне. У главной — четыре кнопки и «+»
 * посередине, у разделов — шесть. Сменился раздел — старое меню уезжает, новое
 * приезжает с другой стороны. Прошлое меню помним на уровне модуля: при
 * переходе в «Деньги» меняется вся оболочка, а уехать старому меню надо.
 */

interface Shown {
  ctx: Context;
  items: BarItem[];
}
let lastShown: Shown | null = null;

const RANK: Record<Context, number> = { hub: 0, dash: 1, money: 2 };

export interface HubPlus {
  /** «+» нажат: иконки уехали, на их месте строка ввода. */
  open: boolean;
  setOpen: (v: boolean) => void;
  /** Ввод: текст или голос. */
  onSubmit: (text: string) => void;
  onVoice: () => void;
}

export default function PhoneBar({ ctx, items, plus, badges, className }: { ctx: Context; items: BarItem[]; plus?: HubPlus; badges?: Record<string, number>; className?: string }) {
  const path = usePathname();
  const [leaving, setLeaving] = useState<(Shown & { to: 'left' | 'right' }) | null>(null);
  const [enterFrom, setEnterFrom] = useState<'left' | 'right' | null>(null);

  useEffect(() => {
    const prev = lastShown;
    lastShown = { ctx, items };
    // «Назад» жестом — меню просто сменилось, без второго проезда.
    if (!prev || prev.ctx === ctx || wasPop()) return;
    // Вглубь (дальше от главной) — старое уезжает влево, новое приезжает справа.
    const deeper = RANK[ctx] > RANK[prev.ctx];
    setLeaving({ ...prev, to: deeper ? 'left' : 'right' });
    setEnterFrom(deeper ? 'right' : 'left');
  }, [ctx]); // eslint-disable-line react-hooks/exhaustive-deps

  // Уехавшее меню убираем после анимации (отдельно: эффект выше в разработке
  // React запускает дважды, и таймер там отменился бы).
  useEffect(() => {
    if (!leaving) return;
    const t = setTimeout(() => {
      setLeaving(null);
      setEnterFrom(null);
    }, 450);
    return () => clearTimeout(t);
  }, [leaving]);

  return (
    <nav className={`sbar${className ? ` ${className}` : ''}`} aria-label="Разделы">
      {leaving && (
        <div className={`sbar-row ${leaving.ctx === 'hub' ? 'five' : 'six'} sbar-out-${leaving.to}`} aria-hidden="true">
          <Row ctx={leaving.ctx} items={leaving.items} path="" />
        </div>
      )}
      <div className={`sbar-row ${ctx === 'hub' ? 'five' : 'six'}${enterFrom ? ` sbar-in-${enterFrom}` : ''}${plus?.open ? ' typing' : ''}`}>
        <Row ctx={ctx} items={items} path={path} plus={plus} badges={badges} />
      </div>
    </nav>
  );
}

function Row({ ctx, items, path, plus, badges }: { ctx: Context; items: BarItem[]; path: string; plus?: HubPlus; badges?: Record<string, number> }) {
  const active = path ? activeIndex(items, path) : -1;
  const link = (it: BarItem, i: number, cls = '') => (
    <Link key={it.href + i} className={`sbar-btn${cls}`} href={it.href} aria-current={i === active ? 'page' : undefined} tabIndex={plus?.open ? -1 : undefined}>
      <Icon name={it.icon} size={22} />
      <span className="sbar-label">{it.label}</span>
      {!!badges?.[it.href] && (
        <span className="badge" aria-label={`${badges[it.href]} на сегодня`}>
          {badges[it.href]}
        </span>
      )}
    </Link>
  );
  // В разделах первая — «Главная»: она ведёт из раздела, остальные — внутри него.
  if (ctx !== 'hub') return <>{items.map((it, i) => link(it, i, i === 0 ? ' sbar-home' : ''))}</>;
  return (
    <>
      {link(items[0], 0, ' h1')}
      {link(items[1], 1, ' h2')}
      <span className="sbar-gap" aria-hidden="true" />
      {link(items[2], 2, ' h4')}
      {link(items[3], 3, ' h5')}
      {plus && <PlusInput plus={plus} />}
    </>
  );
}

/** «+» и строка «Записать или спросить…» — появляется, когда иконки уехали. */
function PlusInput({ plus }: { plus: HubPlus }) {
  const [text, setText] = useState('');
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (plus.open) setTimeout(() => input.current?.focus(), 120);
    else setText('');
  }, [plus.open]);
  return (
    <>
      <form
        className="sbar-say"
        aria-hidden={!plus.open}
        onSubmit={(e) => {
          e.preventDefault();
          const t = text.trim();
          if (t) plus.onSubmit(t);
        }}
      >
        <label htmlFor="sbar-input" className="sr-only">
          Записать или спросить
        </label>
        <input
          id="sbar-input"
          ref={input}
          className="sbar-input"
          type="text"
          enterKeyHint="send"
          autoComplete="off"
          placeholder="Записать или спросить…"
          value={text}
          tabIndex={plus.open ? 0 : -1}
          onChange={(e) => setText(e.target.value)}
        />
        {text.trim() ? (
          <button className="sbar-mic" type="submit" aria-label="Разобрать" tabIndex={plus.open ? 0 : -1}>
            <Icon name="arrow" size={22} />
          </button>
        ) : (
          <button className="sbar-mic" type="button" aria-label="Сказать голосом" tabIndex={plus.open ? 0 : -1} onClick={plus.onVoice}>
            <Icon name="mic" size={22} />
          </button>
        )}
      </form>
      <button className="sbar-plus" type="button" aria-label={plus.open ? 'Закрыть' : 'Записать'} aria-expanded={plus.open} onClick={() => plus.setOpen(!plus.open)}>
        <Icon name="plus" size={26} strokeWidth={2.2} />
      </button>
    </>
  );
}
