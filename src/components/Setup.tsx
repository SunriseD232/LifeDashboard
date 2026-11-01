'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { BAR_CHOICES, parseHub } from '@/lib/hub';
import { applySetup, defaultSetup, SETUP_ITEMS, type SetupChoice } from '@/lib/setup';
import { useApp } from './AppShell';
import { Icon } from './icons';

/**
 * «Что вам нужно?» — разделы включаются нажатием и переставляются
 * стрелками; внизу — как будет выглядеть нижнее меню. Сохраняем одним
 * запросом: меню, плитки, быстрые действия (src/lib/setup.ts).
 */
export default function Setup({ onDone }: { onDone: () => void }) {
  const { data, mutate, toast } = useApp();
  const [list, setList] = useState<SetupChoice[]>(defaultSetup);
  const byId = new Map(SETUP_ITEMS.map((i) => [i.id, i]));
  const hub = parseHub(data.settings.hub);
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
    const { nav, hub: next } = applySetup(list, hub);
    mutate(
      (d) => ({ ...d, settings: { ...d.settings, nav, hub: next } }),
      () => api('settings', 'PATCH', { nav, hub: next }),
    );
    toast('Готово — поменять можно в «Настройках»');
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
        Сохранить и дальше
      </button>
    </div>
  );
}
