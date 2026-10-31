'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { quickActions, type QuickAction } from '@/lib/quickActions';
import { splitSnippet, type SearchHit, type SearchKind } from '@/lib/search';
import { useAppMaybe } from './AppShell';
import { Icon } from './icons';
import { useModalFocus } from './useModalFocus';

const KINDS: { id: SearchKind; label: string; icon: string }[] = [
  { id: 'task', label: 'Задачи', icon: 'tasks' },
  { id: 'note', label: 'Заметки', icon: 'note' },
  { id: 'checklist', label: 'Чек-листы', icon: 'list' },
  { id: 'item', label: 'В чек-листах', icon: 'check' },
  { id: 'reminder', label: 'Напоминания', icon: 'bell' },
  { id: 'recipe', label: 'Рецепты', icon: 'pot' },
  { id: 'vacation', label: 'Отпуска', icon: 'suitcase' },
  { id: 'workout', label: 'Тренировки', icon: 'dumbbell' },
  { id: 'op', label: 'Операции', icon: 'wallet' },
  { id: 'account', label: 'Счета', icon: 'receipt' },
  { id: 'debt', label: 'Долги', icon: 'users' },
  { id: 'goal', label: 'Цели', icon: 'flag' },
];

type Item = { type: 'action'; a: QuickAction } | { type: 'hit'; h: SearchHit };
const itemId = (x: Item) => (x.type === 'action' ? `sr-act-${x.a.id}` : `sr-${x.h.kind}-${x.h.id}`);

/** Куда ведёт найденное (чек-листы — отдельно: их открывают через общий выбор). */
const ROUTES: Partial<Record<SearchKind, (h: SearchHit) => string>> = {
  note: (h) => `/notes?open=${h.id}`,
  task: (h) => `/tasks?open=${h.id}`,
  reminder: (h) => `/tasks?edit=${h.id}`,
  recipe: (h) => `/kitchen/${h.id}`,
  vacation: () => '/vacations',
  workout: () => '/workouts',
  op: (h) => `/money/ops?op=${h.id}${h.month ? `&month=${h.month}` : ''}`,
  account: () => '/money/accounts',
  debt: () => '/money/debts',
  goal: () => '/money/goals',
};

/**
 * Поиск по всему (Ctrl K / ⌘K, кнопка «Поиск»): дела, заметки, чек-листы с
 * пунктами, напоминания, рецепты, отпуска, тренировки и «Деньги» — своё и
 * общее семьи. Сверху — быстрые действия: «трата», «настройки», «отпуск».
 * Работает и в «Деньгах» (там нет данных LifeDashboard — названия из ответа).
 * ↑↓ — выбрать, Enter — открыть, Esc — закрыть. Ищет по началу слов, «ё» = «е».
 */
export default function SearchDialog({ onClose }: { onClose: () => void }) {
  const app = useAppMaybe();
  const data = app?.data;
  const [withMoney, setWithMoney] = useState(false);
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [kind, setKind] = useState<SearchKind | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  useModalFocus(boxRef);

  useEffect(() => {
    inputRef.current?.focus();
    // Пустой запрос — только узнать, открыты ли «Деньги» (быстрые действия про траты).
    api<{ money?: boolean }>('search?q=')
      .then((r) => setWithMoney(!!r.money))
      .catch(() => undefined);
  }, []);

  // Запрос — через 150 мс после последней буквы; ответ на старый ввод не
  // затирает новый.
  useEffect(() => {
    const text = q.trim();
    if (!text) {
      setHits(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      api<{ results: SearchHit[] }>(`search?q=${encodeURIComponent(text)}`)
        .then((r) => {
          if (!alive) return;
          setHits(r.results);
          setActive(0);
        })
        .catch(() => alive && setHits([]));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q]);

  // Названия — из своих данных (в индексе «ё» заменена на «е»).
  const titleOf = (h: SearchHit): string => {
    if (!data) return h.title;
    if (h.kind === 'task') return data.tasks.find((t) => t.id === h.id)?.title ?? h.title;
    if (h.kind === 'note') return data.notes.find((n) => n.id === h.id)?.title || h.title || 'Без названия';
    if (h.kind === 'checklist') return data.checklists.find((c) => c.id === h.id)?.title ?? h.title;
    if (h.kind === 'item') return data.items.find((i) => i.id === h.id)?.title ?? h.title;
    if (h.kind === 'recipe') return data.kitchen.recipes.find((r) => r.id === h.id)?.title ?? h.title;
    if (h.kind === 'reminder') return data.reminders.find((r) => r.id === h.id)?.title ?? h.title;
    return h.title;
  };

  const counts = useMemo(() => {
    const c = new Map<SearchKind, number>();
    for (const h of hits ?? []) c.set(h.kind, (c.get(h.kind) ?? 0) + 1);
    return c;
  }, [hits]);
  const shown = (hits ?? []).filter((h) => !kind || h.kind === kind);
  // Группы — в порядке KINDS; плоский список — для стрелок.
  const groups = KINDS.map((k) => ({ ...k, hits: shown.filter((h) => h.kind === k.id) })).filter((g) => g.hits.length);
  // Быстрые действия — над найденным; когда выбран раздел, не мешают.
  const actions = kind ? [] : quickActions(q, withMoney);
  const flat: Item[] = [...actions.map((a) => ({ type: 'action' as const, a })), ...groups.flatMap((g) => g.hits.map((h) => ({ type: 'hit' as const, h })))];

  const open = (x: Item) => {
    onClose();
    if (x.type === 'action') return router.push(x.a.href);
    const h = x.h;
    const to = ROUTES[h.kind];
    if (to) return router.push(to(h));
    // Чек-лист: в «Дашборде» — сразу открыть, из «Денег» — через адрес.
    const list = h.kind === 'item' ? h.parent?.id ?? null : h.id;
    if (app) {
      app.setOpenList(list);
      router.push('/lists');
    } else router.push(list ? `/lists?list=${list}` : '/lists');
  };

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!flat.length) return;
      const next = (active + (e.key === 'ArrowDown' ? 1 : -1) + flat.length) % flat.length;
      setActive(next);
      listRef.current?.querySelector(`[data-i="${next}"]`)?.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter' && flat[active]) {
      e.preventDefault();
      open(flat[active]);
    }
  };

  let i = -1;
  return (
    <div className="overlay search-overlay" onClick={onClose}>
      <div ref={boxRef} className="search-box" role="dialog" aria-modal="true" aria-label="Поиск" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
        <div className="search-input">
          <Icon name="search" size={22} />
          <label className="sr-only" htmlFor="search-q">
            Искать везде
          </label>
          <input
            id="search-q"
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Найти или перейти: дела, траты, настройки…"
            autoComplete="off"
            role="combobox"
            aria-expanded={!!flat.length}
            aria-controls="search-results"
            aria-activedescendant={flat[active] ? itemId(flat[active]) : undefined}
          />
          <button className="kbd-btn" type="button" onClick={onClose} aria-label="Закрыть поиск">
            Esc
          </button>
        </div>

        {hits && hits.length > 0 && (
          <div className="search-kinds" role="group" aria-label="Где искать">
            <button className="chip" type="button" aria-pressed={!kind} onClick={() => setKind(null)}>
              Везде · {hits.length}
            </button>
            {KINDS.filter((k) => counts.get(k.id)).map((k) => (
              <button key={k.id} className="chip" type="button" aria-pressed={kind === k.id} onClick={() => setKind(kind === k.id ? null : k.id)}>
                {k.label} · {counts.get(k.id)}
              </button>
            ))}
          </div>
        )}

        {/* Сколько нашлось — диктору; сам список он видит через стрелки. */}
        <div className="sr-only" role="status" aria-live="polite">
          {hits ? (hits.length ? `Найдено: ${hits.length}` : 'Ничего не нашлось') : ''}
        </div>
        {hits && hits.length === 0 && !actions.length && <p className="search-empty">Ничего не нашлось.</p>}
        <div className="search-results" id="search-results" role="listbox" aria-label="Результаты" ref={listRef}>
          {actions.length > 0 && (
            <div role="group" aria-labelledby="sr-g-actions">
              <div id="sr-g-actions" className="group-title" style={{ padding: '10px 12px 4px' }}>
                {q.trim() ? 'Перейти' : 'Часто нужное'}
              </div>
              {actions.map((a) => {
                i++;
                const idx = i;
                return (
                  <button
                    key={a.id}
                    id={`sr-act-${a.id}`}
                    data-i={idx}
                    role="option"
                    aria-selected={idx === active}
                    tabIndex={-1}
                    type="button"
                    className="search-hit"
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => open({ type: 'action', a })}
                  >
                    <span className="list-icon" style={{ width: 36, height: 36 }}>
                      <Icon name={a.icon} size={18} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0, fontWeight: 600 }}>{a.label}</span>
                    <Icon name="arrow" size={16} />
                  </button>
                );
              })}
            </div>
          )}
          {groups.map((g) => (
            <div key={g.id} role="group" aria-labelledby={`sr-g-${g.id}`}>
              <div id={`sr-g-${g.id}`} className="group-title" style={{ padding: '10px 12px 4px' }}>
                {g.label}
              </div>
              {g.hits.map((h) => {
                i++;
                const idx = i;
                const title = titleOf(h);
                return (
                  <button
                    key={`${h.kind}-${h.id}`}
                    id={`sr-${h.kind}-${h.id}`}
                    data-i={idx}
                    role="option"
                    aria-selected={idx === active}
                    tabIndex={-1}
                    type="button"
                    className="search-hit"
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => open({ type: 'hit', h })}
                  >
                    <span className="list-icon" style={{ width: 36, height: 36 }}>
                      <Icon name={g.icon} size={18} />
                    </span>
                    <span style={{ flex: 1, minWidth: 0 }}>
                      <span style={{ display: 'block', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{title}</span>
                      <span className="search-snippet">
                        {h.parent ? `в чек-листе «${h.parent.title}»${h.snippet.trim() ? ' · ' : ''}` : ''}
                        {h.snippet.trim()
                          ? splitSnippet(h.snippet).map((p, j) => (p.hit ? <mark key={j}>{p.text}</mark> : <span key={j}>{p.text}</span>))
                          : !h.parent && g.label}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="search-foot">
          <span>
            <kbd>↑</kbd> <kbd>↓</kbd> выбрать
          </span>
          <span>
            <kbd>Enter</kbd> открыть
          </span>
          <span>ищу по началу слов</span>
        </div>
      </div>
    </div>
  );
}
