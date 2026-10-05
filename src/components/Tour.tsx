'use client';

import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { tourFor, type TourSection } from '@/lib/tour';
import { useApp } from './AppShell';
import { Icon } from './icons';
import { useModalFocus } from './useModalFocus';

const GAP = 10;
const PAD = 6;

/** Первый видимый элемент из списка селекторов. */
function findTarget(selector?: string): HTMLElement | null {
  if (!selector) return null;
  for (const el of document.querySelectorAll<HTMLElement>(selector)) {
    const r = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden') return el;
  }
  return null;
}

/**
 * Подсказки по разделу (src/lib/tour.ts): затемнение с «окном» вокруг
 * нужного элемента и карточка рядом. Один раз на раздел; «Пропустить раздел»
 * и «Больше не показывать» — сразу запоминаются.
 */
export default function Tour() {
  const { data, mutate } = useApp();
  const pathname = usePathname();
  const [section, setSection] = useState<TourSection | null>(null);
  const [step, setStep] = useState(0);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const [vp, setVp] = useState({ w: 0, h: 0 });
  const card = useRef<HTMLDivElement>(null);
  const [cardH, setCardH] = useState(0);
  const seen = data.settings.tour_seen;
  const steps = section ? section.steps.filter((s) => !s.ai || data.ai) : [];
  const cur = steps[step];

  // Зашли в раздел, который ещё не показывали, — через миг (экран дорисуется).
  useEffect(() => {
    setSection(null);
    const s = tourFor(pathname);
    if (!s || !data.settings.onboarded || seen.includes('*') || seen.includes(s.id)) return;
    const t = setTimeout(() => {
      setStep(0);
      setSection(s);
    }, 900);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, data.settings.onboarded, seen.join(',')]);

  const measure = useCallback(() => {
    setVp({ w: window.innerWidth, h: window.innerHeight });
    const el = findTarget(cur?.target);
    setRect(el ? el.getBoundingClientRect() : null);
  }, [cur?.target]);

  useEffect(() => {
    if (!cur) return;
    const el = findTarget(cur.target);
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    measure();
    const t = setTimeout(measure, 400);
    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);
    return () => {
      clearTimeout(t);
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [cur, measure]);

  useLayoutEffect(() => {
    if (card.current) setCardH(card.current.offsetHeight);
  }, [cur, rect]);

  const remember = (ids: string[]) => {
    const next = [...new Set([...seen, ...ids])];
    mutate(
      (d) => ({ ...d, settings: { ...d.settings, tour_seen: next } }),
      () => api('settings', 'PATCH', { tour_seen: next }),
    );
    setSection(null);
  };

  if (!section || !cur) return null;
  return <TourCard key={`${section.id}:${step}`} {...{ section, steps, step, setStep, rect, vp, card, cardH, remember }} />;
}

function TourCard({
  section,
  steps,
  step,
  setStep,
  rect,
  vp,
  card,
  cardH,
  remember,
}: {
  section: TourSection;
  steps: TourSection['steps'];
  step: number;
  setStep: (n: number) => void;
  rect: DOMRect | null;
  vp: { w: number; h: number };
  card: React.RefObject<HTMLDivElement>;
  cardH: number;
  remember: (ids: string[]) => void;
}) {
  const cur = steps[step];
  const last = step === steps.length - 1;
  useModalFocus(card);
  useEffect(() => {
    card.current?.querySelector<HTMLElement>('.btn-primary')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && remember([section.id]);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const w = Math.min(340, vp.w - 32);
  let style: React.CSSProperties;
  if (rect) {
    // Под элементом, если влезает; иначе над ним; по горизонтали — в пределах экрана.
    const below = rect.bottom + PAD + GAP;
    const top = below + cardH <= vp.h - 16 ? below : Math.max(16, rect.top - PAD - GAP - cardH);
    const left = Math.min(Math.max(16, rect.left + rect.width / 2 - w / 2), vp.w - w - 16);
    style = { top, left, width: w };
  } else style = { top: Math.max(16, (vp.h - cardH) / 2), left: (vp.w - w) / 2, width: w };

  return (
    <div className="tour" role="presentation">
      {rect ? (
        <div className="tour-hole" style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }} />
      ) : (
        <div className="tour-scrim" />
      )}
      <div ref={card} className="tour-card" role="dialog" aria-modal="true" aria-labelledby="tour-title" style={style}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className="tour-step">
            {section.title} · {step + 1} из {steps.length}
          </span>
          <span style={{ flex: 1 }} />
          <button className="icon-btn bare" type="button" aria-label="Пропустить раздел" title="Пропустить раздел" onClick={() => remember([section.id])}>
            <Icon name="x" size={18} />
          </button>
        </div>
        <h2 id="tour-title" className="display" style={{ margin: 0, fontSize: 18 }}>
          {cur.title}
        </h2>
        <p style={{ margin: 0, lineHeight: 1.5 }}>{cur.text}</p>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button className="add-line" type="button" style={{ padding: 0, fontSize: 13 }} onClick={() => remember(['*'])}>
            Больше не показывать
          </button>
          <span style={{ flex: 1 }} />
          {step > 0 && (
            <button className="btn btn-ghost" type="button" style={{ minHeight: 36 }} onClick={() => setStep(step - 1)}>
              Назад
            </button>
          )}
          {!last && (
            <button className="btn btn-ghost" type="button" style={{ minHeight: 36 }} onClick={() => remember([section.id])}>
              Пропустить раздел
            </button>
          )}
          <button className="btn btn-primary" type="button" style={{ minHeight: 36 }} onClick={() => (last ? remember([section.id]) : setStep(step + 1))}>
            {last ? 'Понятно' : 'Далее'}
          </button>
        </div>
      </div>
    </div>
  );
}
