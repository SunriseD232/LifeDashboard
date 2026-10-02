'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import type { MenuDay } from '@/lib/aiParse';
import { deptRank } from '@/lib/kitchenSeed';
import type { ChecklistItem } from '@/lib/types';
import { api } from '@/lib/api';
import { AiButton, compressImage, useAiReady } from './Ai';
import { useApp } from './AppShell';
import { Icon } from './icons';

/**
 * ИИ на кухне: меню на неделю из своих рецептов и запасов и продукты с фото
 * чека или холодильника.
 */

export function MenuPlanner() {
  const { data, reload, toast } = useApp();
  const ready = useAiReady();
  const [open, setOpen] = useState(false);
  const [days, setDays] = useState(7);
  const [prefs, setPrefs] = useState('');
  const [plan, setPlan] = useState<{ plan: MenuDay[]; missing: string[] } | null>(null);
  const [busy, setBusy] = useState(false);
  if (!ready || data.kitchen.recipes.length < 3) return null;
  const title = (id: string) => data.kitchen.recipes.find((r) => r.id === id)?.title ?? '…';
  const name = (id: string) => data.kitchen.products.find((p) => p.id === id)?.name ?? '…';

  const make = async () => {
    setBusy(true);
    try {
      setPlan(await api('ai/menu', 'POST', { days, prefs }));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const toShopping = async () => {
    if (!plan?.missing.length) return;
    try {
      await api('kitchen/shopping', 'POST', { items: plan.missing.map((id) => ({ product_id: id, recipe: 'меню' })) });
      await reload();
      toast(`В покупки: ${plan.missing.length}`);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  const toNote = async () => {
    if (!plan) return;
    const body = plan.plan.map((d) => `${d.day}\n${d.meals.map((m) => `- ${m.meal ? `${m.meal}: ` : ''}${title(m.recipe_id)}`).join('\n')}`).join('\n\n');
    try {
      await api('notes', 'POST', { title: 'Меню на неделю', body, tags: ['кухня'], pinned: true });
      await reload();
      toast('Меню сохранено в заметки и закреплено');
    } catch (e) {
      toast((e as Error).message);
    }
  };

  if (!open) {
    return (
      <AiButton onClick={() => setOpen(true)} style={{ alignSelf: 'flex-start' }}>
        Меню на неделю
      </AiButton>
    );
  }

  return (
    <section className="card ai-card" aria-labelledby="menu-title">
      <div className="card-head">
        <h2 className="card-title display" id="menu-title">
          <Icon name="sparkles" />
          Меню
        </h2>
        <button className="icon-btn bare" type="button" aria-label="Закрыть меню" onClick={() => setOpen(false)} style={{ marginLeft: 'auto' }}>
          <Icon name="x" size={18} />
        </button>
      </div>
      <p style={{ margin: '-8px 0 0', fontSize: 14, color: 'var(--muted)' }}>Из ваших рецептов — так, чтобы чаще готовить из того, что уже есть дома.</p>
      <div className="task-fields">
        <div className="fld">
          <label className="label" htmlFor="menu-days">
            На сколько дней
          </label>
          <select id="menu-days" className="field" value={days} onChange={(e) => setDays(Number(e.target.value))}>
            {[1, 2, 3, 4, 5, 6, 7].map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
        <div className="fld">
          <label className="label" htmlFor="menu-prefs">
            Пожелания
          </label>
          <input id="menu-prefs" className="field" maxLength={300} placeholder="без рыбы, ужины до 30 минут…" value={prefs} onChange={(e) => setPrefs(e.target.value)} />
        </div>
      </div>
      <AiButton busy={busy} onClick={make} style={{ alignSelf: 'flex-start' }}>
        {plan ? 'Составить заново' : 'Составить меню'}
      </AiButton>
      {plan && (
        <>
          <div className="menu-plan">
            {plan.plan.map((d) => (
              <div key={d.day}>
                <h3 className="group-title" style={{ padding: 0 }}>
                  {d.day}
                </h3>
                {d.meals.map((m, i) => (
                  <Link key={i} href={`/kitchen/${m.recipe_id}`} className="menu-meal">
                    <span style={{ color: 'var(--muted)', fontSize: 13, minWidth: 64 }}>{m.meal}</span>
                    <span>{title(m.recipe_id)}</span>
                  </Link>
                ))}
              </div>
            ))}
          </div>
          {plan.missing.length > 0 ? (
            <p style={{ margin: 0, fontSize: 14 }}>
              Не хватает: <span style={{ color: 'var(--muted)' }}>{plan.missing.map(name).join(', ')}</span>
            </p>
          ) : (
            <p style={{ margin: 0, fontSize: 14, color: 'var(--accent-ink)' }}>Всё для этого меню есть дома.</p>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {plan.missing.length > 0 && (
              <button className="btn btn-primary" type="button" onClick={toShopping}>
                <Icon name="cart" size={18} />
                Недостающее — в покупки
              </button>
            )}
            <button className="btn btn-ghost" type="button" onClick={toNote}>
              <Icon name="pin" size={18} />
              Сохранить в заметки
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Фото чека или холодильника → продукты в «что есть дома». */
export function PantryPhoto({ onAdd }: { onAdd: (names: string[]) => Promise<void> }) {
  const { toast } = useApp();
  const ready = useAiReady();
  const input = useRef<HTMLInputElement>(null);
  const [found, setFound] = useState<string[] | null>(null);
  const [pick, setPick] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  if (!ready) return null;

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setBusy(true);
    try {
      const image = await compressImage(f);
      const r = await api<{ products: string[] }>('ai/pantry-photo', 'POST', { image });
      setFound(r.products);
      setPick(r.products);
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  };

  return (
    <>
      <input ref={input} type="file" accept="image/*" capture="environment" className="sr-only" aria-label="Фото чека или холодильника" onChange={(e) => onFile(e.target.files?.[0])} />
      <AiButton busy={busy} onClick={() => input.current?.click()} style={{ alignSelf: 'flex-start' }}>
        По фото чека или холодильника
      </AiButton>
      {found && (
        <div className="added-box" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
          <span>Нашёл на фото — отметьте, что положить в «есть дома»:</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {found.map((n) => (
              <button key={n} type="button" className="chip" aria-pressed={pick.includes(n)} onClick={() => setPick(pick.includes(n) ? pick.filter((x) => x !== n) : [...pick, n])}>
                {n}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button
              className="btn btn-primary"
              type="button"
              disabled={!pick.length}
              onClick={async () => {
                await onAdd(pick);
                setFound(null);
              }}
            >
              Добавить ({pick.length})
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setFound(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Режим магазина: только список, крупно, по отделам в порядке обхода.
 * Нажал строку — куплено, она уходит вниз зачёркнутой. Экран не гаснет
 * (Wake Lock, где браузер позволяет).
 */
export function StoreMode({ items, onToggle, onClose }: { items: ChecklistItem[]; onToggle: (i: ChecklistItem, done: boolean) => void; onClose: () => void }) {
  useEffect(() => {
    type Lock = { release: () => Promise<void> };
    let lock: Lock | null = null;
    const ask = async () => {
      try {
        lock = await (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<Lock> } }).wakeLock?.request('screen') ?? null;
      } catch {
        /* не дали — ничего страшного */
      }
    };
    ask();
    const again = () => document.visibilityState === 'visible' && ask();
    document.addEventListener('visibilitychange', again);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('visibilitychange', again);
      window.removeEventListener('keydown', esc);
      lock?.release().catch(() => undefined);
    };
  }, [onClose]);

  const open = items.filter((i) => !i.done);
  const bought = items.filter((i) => i.done);
  const depts = [...new Set(open.map((i) => i.group_name ?? 'Другое'))].sort((a, b) => deptRank(a) - deptRank(b));
  const row = (i: ChecklistItem) => (
    <button key={i.id} type="button" className="store-row" data-done={i.done || undefined} aria-pressed={i.done} onClick={() => onToggle(i, !i.done)}>
      <span className="store-check" aria-hidden="true">
        {i.done && <Icon name="check" size={18} strokeWidth={2.4} />}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>{i.title}</span>
      {i.qty !== null && i.qty !== undefined && <span className="mono store-qty">{i.note?.split(' · ')[0]}</span>}
    </button>
  );

  return (
    <div className="store" role="dialog" aria-modal="true" aria-label="Режим магазина">
      <div className="store-head">
        <div style={{ flex: 1 }}>
          <div className="display" style={{ fontSize: 22, fontWeight: 700 }}>
            В магазине
          </div>
          <div style={{ color: 'var(--muted)', fontSize: 14 }}>{open.length ? `Осталось ${open.length} из ${items.length}` : 'Всё куплено'}</div>
        </div>
        <button className="btn btn-primary" type="button" onClick={onClose}>
          Готово
        </button>
      </div>
      <div className="store-list">
        {depts.map((d) => (
          <section key={d}>
            <h2 className="group-title store-dept">{d}</h2>
            {open.filter((i) => (i.group_name ?? 'Другое') === d).map(row)}
          </section>
        ))}
        {bought.length > 0 && (
          <section>
            <h2 className="group-title store-dept">Куплено</h2>
            {bought.map(row)}
          </section>
        )}
      </div>
    </div>
  );
}
