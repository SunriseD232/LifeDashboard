'use client';

import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { BAR_CHOICES, parseHub } from '@/lib/hub';
import { applySetup, sameSetup, SETUP_ITEMS, SETUP_SEEN, setupFrom, type SetupChoice } from '@/lib/setup';
import { useApp } from './AppShell';
import { Icon } from './icons';
import { useModalFocus } from './useModalFocus';

/**
 * «Что вам нужно?» — разделы включаются нажатием и переставляются
 * стрелками; внизу — как будет выглядеть нижнее меню. Начинаем с того, как
 * сейчас (у нового — всё включено). Сохраняем одним запросом: меню, плитки,
 * быстрые действия (src/lib/setup.ts) и отметку «уже показали».
 */
// В знакомстве отметку ставит его конец (markSeen=false): иначе подсказки разделов полезли бы поверх.
export default function Setup({ onDone, action = 'Сохранить и дальше', markSeen = true }: { onDone: () => void; action?: string; markSeen?: boolean }) {
  const { data, mutate, toast } = useApp();
  const hub = parseHub(data.settings.hub);
  const [start] = useState(() => setupFrom(data.settings.nav, hub));
  const [list, setList] = useState<SetupChoice[]>(start);
  const byId = new Map(SETUP_ITEMS.map((i) => [i.id, i]));
  const preview = applySetup(list, hub).hub.bar ?? [];
  const barById = new Map(BAR_CHOICES.map((b) => [b.id, b]));
  const onCount = list.filter((c) => c.on).length;

  const move = (i: number, to: number) =>
    setList((l) => {
      const next = [...l];
      [next[i], next[to]] = [next[to], next[i]];
      return next;
    });
  const toggle = (id: string) => setList((l) => l.map((c) => (c.id === id ? { ...c, on: !c.on } : c)));

  const save = () => {
    const tour_seen = markSeen ? [...new Set([...data.settings.tour_seen, SETUP_SEEN])] : data.settings.tour_seen;
    // Ничего не поменяли — свои плитки и нижнее меню не трогаем.
    if (sameSetup(list, start)) {
      mutate(
        (d) => ({ ...d, settings: { ...d.settings, tour_seen } }),
        () => api('settings', 'PATCH', { tour_seen }),
      );
    } else {
      const { nav, hub: next } = applySetup(list, hub);
      mutate(
        (d) => ({ ...d, settings: { ...d.settings, nav, hub: next, tour_seen } }),
        () => api('settings', 'PATCH', { nav, hub: next, tour_seen }),
      );
      toast('Готово — поменять можно в «Настройках»');
    }
    onDone();
  };

  return (
    <div className="setup">
      <ol className="setup-list">
        {list.map((c, i) => {
          const it = byId.get(c.id)!;
          return (
            <li key={c.id} className="setup-row" data-off={!c.on || undefined}>
              <label className="setup-pick">
                <input type="checkbox" checked={c.on} onChange={() => toggle(c.id)} />
                <span className="setup-ic" aria-hidden="true">
                  <Icon name={it.icon} size={18} />
                </span>
                <span className="setup-t">
                  <b>{it.label}</b>
                  <small>{it.hint}</small>
                </span>
              </label>
              <button className="icon-btn bare" type="button" aria-label={`${it.label} выше`} disabled={i === 0} onClick={() => move(i, i - 1)}>
                <Icon name="up" size={18} />
              </button>
              <button className="icon-btn bare" type="button" aria-label={`${it.label} ниже`} disabled={i === list.length - 1} onClick={() => move(i, i + 1)}>
                <Icon name="down" size={18} />
              </button>
            </li>
          );
        })}
      </ol>
      <div className="hubset-preview" role="img" aria-label={`Нижнее меню на телефоне: ${preview.map((id) => barById.get(id)?.label).join(', ')}`}>
        {preview.map((id, i) => (
          <span key={id} style={{ order: i < 2 ? i : i + 1 }}>
            <Icon name={barById.get(id)?.icon ?? 'home'} size={18} />
            {barById.get(id)?.label}
          </span>
        ))}
        <b style={{ order: 2 }} aria-hidden="true">
          <Icon name="plus" size={20} strokeWidth={2.2} />
        </b>
      </div>
      <button className="btn btn-primary" type="button" disabled={onCount === 0} onClick={save}>
        <Icon name="check" size={18} />
        {action}
      </button>
    </div>
  );
}

/**
 * Тем, кто пришёл до «Что вам нужно?», — один раз отдельным окном, с их
 * нынешними разделами. «Не сейчас» — больше не спрашиваем (вернуть можно
 * «Пройти знакомство заново» в настройках).
 */
export function SetupPrompt() {
  const { data, mutate } = useApp();
  const box = useRef<HTMLDivElement>(null);
  const head = useRef<HTMLHeadingElement>(null);
  const [open, setOpen] = useState(true);
  useModalFocus(box);
  useEffect(() => head.current?.focus(), []);
  if (!open) return null;
  const later = () => {
    const tour_seen = [...new Set([...data.settings.tour_seen, SETUP_SEEN])];
    setOpen(false);
    mutate(
      (d) => ({ ...d, settings: { ...d.settings, tour_seen } }),
      () => api('settings', 'PATCH', { tour_seen }),
    );
  };
  return (
    <div className="onboarding" role="dialog" aria-modal="true" aria-labelledby="setup-title">
      <div ref={box} className="onboarding-box">
        <div className="onboarding-top">
          <span className="chip">Новое</span>
          <button className="add-line" type="button" onClick={later} style={{ padding: 0 }}>
            Не сейчас
          </button>
        </div>
        <h1 ref={head} id="setup-title" tabIndex={-1} className="display" style={{ margin: 0, fontSize: 'calc(26px * var(--fs))', outline: 'none' }}>
          Что вам нужно?
        </h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>Отметьте нужные разделы и поставьте по порядку — так соберутся меню, плитки главной и кнопки внизу. Сейчас — как у вас настроено.</p>
        <Setup action="Сохранить" onDone={() => setOpen(false)} />
      </div>
    </div>
  );
}
