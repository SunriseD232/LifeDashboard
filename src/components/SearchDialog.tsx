'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { splitSnippet, type SearchHit, type SearchKind } from '@/lib/search';
import { useApp } from './AppShell';
import { Icon } from './icons';

const KINDS: { id: SearchKind; label: string; icon: string }[] = [
  { id: 'task', label: 'Дела', icon: 'tasks' },
  { id: 'note', label: 'Заметки', icon: 'note' },
  { id: 'checklist', label: 'Чек-листы', icon: 'list' },
  { id: 'item', label: 'В чек-листах', icon: 'check' },
  { id: 'reminder', label: 'Напоминания', icon: 'bell' },
  { id: 'recipe', label: 'Рецепты', icon: 'pot' },
];

/**
 * Поиск по всему (Ctrl K / ⌘K, кнопка «Поиск»): дела, заметки, чек-листы с
 * пунктами, напоминания — своё и общее семьи. ↑↓ — выбрать, Enter — открыть,
 * Esc — закрыть. Ищет по началу слов, «ё» = «е» (src/lib/search.ts).
 */
export default function SearchDialog({ onClose }: { onClose: () => void }) {
  const { data, setOpenList } = useApp();
  const router = useRouter();
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const [kind, setKind] = useState<SearchKind | null>(null);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
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
    if (h.kind === 'task') return data.tasks.find((t) => t.id === h.id)?.title ?? h.title;
    if (h.kind === 'note') return data.notes.find((n) => n.id === h.id)?.title || h.title || 'Без названия';
    if (h.kind === 'checklist') return data.checklists.find((c) => c.id === h.id)?.title ?? h.title;
    if (h.kind === 'item') return data.items.find((i) => i.id === h.id)?.title ?? h.title;
    if (h.kind === 'recipe') return data.kitchen.recipes.find((r) => r.id === h.id)?.title ?? h.title;
    return data.reminders.find((r) => r.id === h.id)?.title ?? h.title;
  };

  const counts = useMemo(() => {
    const c = new Map<SearchKind, number>();
    for (const h of hits ?? []) c.set(h.kind, (c.get(h.kind) ?? 0) + 1);
    return c;
  }, [hits]);
  const shown = (hits ?? []).filter((h) => !kind || h.kind === kind);
  // Группы — в порядке KINDS; плоский список — для стрелок.
  const groups = KINDS.map((k) => ({ ...k, hits: shown.filter((h) => h.kind === k.id) })).filter((g) => g.hits.length);
  const flat = groups.flatMap((g) => g.hits);

  const open = (h: SearchHit) => {
    onClose();
    if (h.kind === 'note') router.push(`/notes?open=${h.id}`);
    else if (h.kind === 'task') router.push(`/tasks?open=${h.id}`);
    else if (h.kind === 'reminder') router.push(`/reminders?edit=${h.id}`);
    else if (h.kind === 'recipe') router.push(`/kitchen/${h.id}`);
    else {
      setOpenList(h.kind === 'item' ? h.parent?.id ?? null : h.id);
      router.push('/lists');
    }
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
      <div className="search-box" role="dialog" aria-modal="true" aria-label="Поиск" onClick={(e) => e.stopPropagation()} onKeyDown={onKey}>
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
            placeholder="Дела, заметки, чек-листы, рецепты…"
            autoComplete="off"
            role="combobox"
            aria-expanded={!!flat.length}
            aria-controls="search-results"
            aria-activedescendant={flat[active] ? `sr-${flat[active].kind}-${flat[active].id}` : undefined}
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

        <div className="search-results" id="search-results" role="listbox" ref={listRef}>
          {!q.trim() && <p className="search-empty">Начните печатать — ищу по началу слов везде сразу.</p>}
          {hits && hits.length === 0 && <p className="search-empty">Ничего не нашлось.</p>}
          {groups.map((g) => (
            <div key={g.id} role="presentation">
              <h3 className="group-title" style={{ padding: '10px 12px 4px' }}>
                {g.label}
              </h3>
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
                    type="button"
                    className="search-hit"
                    onMouseEnter={() => setActive(idx)}
                    onClick={() => open(h)}
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
        </div>
      </div>
    </div>
  );
}
