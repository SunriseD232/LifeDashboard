'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { normalize } from '@/lib/search';
import type { Note } from '@/lib/types';
import { useApp } from './AppShell';
import Confirm from './Confirm';
import { Icon } from './icons';
import Empty from './Empty';
import { Fab, useIsPhone } from './Phone';
import { AiButton, useAiReady } from './Ai';
import { localDay } from '@/lib/dates';
import { shortDate } from '@/lib/tasks';

const SAVE_DELAY = 700;

/** Заголовок для списка: свой или первая строка текста. */
export function noteTitle(n: Pick<Note, 'title' | 'body'>): string {
  return n.title.trim() || n.body.trim().split('\n')[0].slice(0, 80) || 'Без названия';
}

/** Время правки (в базе — UTC): «сегодня в 11:20», «вчера», «12 окт». */
export function editedLabel(updatedAt: string, now: Date): string {
  const d = new Date(updatedAt.replace(' ', 'T') + 'Z');
  const day = (x: Date) => x.toDateString();
  if (day(d) === day(now)) return `сегодня в ${d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`;
  const y = new Date(now);
  y.setDate(y.getDate() - 1);
  if (day(d) === day(y)) return 'вчера';
  return d.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: d.getFullYear() === now.getFullYear() ? undefined : 'numeric' });
}

const parseTags = (s: string) => [...new Set(s.split(',').map((t) => t.trim().toLowerCase()).filter(Boolean))].slice(0, 10);

type Patch = Partial<Pick<Note, 'title' | 'body' | 'tags' | 'pinned' | 'checklist_id'>> & { shared?: boolean };

/** ИИ: найти в заметке дела со сроками → отметить нужные → в «Дела». */
function NoteTasks({ noteId }: { noteId: string }) {
  const { data, reload, toast, now } = useApp();
  const ready = useAiReady();
  const [found, setFound] = useState<{ title: string; due_date: string | null }[] | null>(null);
  const [pick, setPick] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  if (!ready) return null;

  const find = async () => {
    setBusy(true);
    try {
      const r = await api<{ tasks: { title: string; due_date: string | null }[] }>('ai/note-tasks', 'POST', { note_id: noteId, today: localDay(now) });
      if (!r.tasks.length) toast('Задач в заметке не нашёл');
      setFound(r.tasks.length ? r.tasks : null);
      setPick(r.tasks.map(() => true));
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    try {
      // Со сроком — задача с напоминанием в этот день, без — просто в список.
      for (const [i, t] of (found ?? []).entries()) {
        if (!pick[i]) continue;
        if (t.due_date) await api('reminders', 'POST', { title: t.title.slice(0, 120), times: [data.settings.deadline_time], rule: { kind: 'once', date: t.due_date }, checklist_id: null });
        else await api('tasks', 'POST', { title: t.title });
      }
      await reload();
      toast(`В «Задачи»: ${pick.filter(Boolean).length}`);
      setFound(null);
    } catch (e) {
      toast((e as Error).message);
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {found && (
        <div
          className="added-box"
          style={{
            flexDirection: 'column',
            alignItems: 'stretch',
            fontWeight: 400,
          }}
        >
          {found.map((t, i) => (
            <label key={i} className="check" style={{ padding: '4px 0' }}>
              <input type="checkbox" checked={pick[i]} onChange={(e) => setPick(pick.map((p, j) => (j === i ? e.target.checked : p)))} />
              <span className="check-text">
                {t.title}
                {t.due_date && <span style={{ color: 'var(--muted)', fontSize: 'calc(13px * var(--fs))' }}> · напомню {shortDate(t.due_date, localDay(now))} в {data.settings.deadline_time}</span>}
              </span>
            </label>
          ))}
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-primary" type="button" disabled={!pick.some(Boolean)} onClick={add}>
              В задачи ({pick.filter(Boolean).length})
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setFound(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}
      {!found && (
        <AiButton busy={busy} onClick={find} style={{ alignSelf: 'flex-start' }}>
          Найти задачи в заметке
        </AiButton>
      )}
    </div>
  );
}

/**
 * Редактор: пишется — сохраняется (через SAVE_DELAY после последней буквы,
 * а при уходе со страницы или переключении заметки — сразу).
 */
function Editor({ note, onBack, onDeleted }: { note: Note; onBack: () => void; onDeleted: () => void }) {
  const { data, mutate, reload, now, toast } = useApp();
  const [title, setTitle] = useState(note.title);
  const [body, setBody] = useState(note.body);
  const [tags, setTags] = useState(note.tags.join(', '));
  const [status, setStatus] = useState<'saved' | 'dirty' | 'saving'>('saved');
  const [confirm, setConfirm] = useState(false);
  const pending = useRef<Patch>({});
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const bodyRef = useRef<HTMLTextAreaElement>(null);

  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const patch = pending.current;
    pending.current = {};
    if (!Object.keys(patch).length) return;
    setStatus('saving');
    const stamp = new Date().toISOString().slice(0, 19).replace('T', ' ');
    mutate(
      (d) => ({
        ...d,
        notes: d.notes.map((n) => {
          if (n.id !== note.id) return n;
          const { shared, ...rest } = patch;
          return { ...n, ...rest, ...(shared !== undefined ? { household_id: shared ? data.household?.id ?? null : null } : {}), updated_at: stamp };
        }),
      }),
      () => api(`notes/${note.id}`, 'PATCH', patch).then(() => setStatus((s) => (s === 'saving' ? 'saved' : s))),
    );
  }, [mutate, note.id, data.household?.id]);

  const change = (p: Patch, immediate = false) => {
    pending.current = { ...pending.current, ...p };
    setStatus('dirty');
    if (timer.current) clearTimeout(timer.current);
    if (immediate) flush();
    else timer.current = setTimeout(flush, SAVE_DELAY);
  };

  // Ушли со страницы или на другую заметку — не теряем недописанное.
  useEffect(() => {
    const onHide = () => flush();
    window.addEventListener('pagehide', onHide);
    return () => {
      window.removeEventListener('pagehide', onHide);
      flush();
    };
  }, [flush]);

  // Текст растёт вместе с содержимым — без второй прокрутки внутри страницы.
  useEffect(() => {
    const el = bodyRef.current;
    if (!el) return;
    el.style.height = 'auto';
    // Нижнюю границу задаёт min-height в стилях (на телефоне — меньше).
    el.style.height = `${el.scrollHeight}px`;
  }, [body]);

  const mine = !note.author;
  const remove = async () => {
    setConfirm(false);
    pending.current = {};
    try {
      await api(`notes/${note.id}`, 'DELETE');
      await reload();
      onDeleted();
    } catch (err) {
      toast((err as Error).message);
    }
  };

  return (
    <article className="card note-editor">
      <div className="note-toolbar">
        <button className="icon-btn bare only-mobile" type="button" aria-label="Назад к заметкам" onClick={onBack}>
          <Icon name="back" />
        </button>
        <span style={{ fontSize: 'calc(13px * var(--fs))', color: 'var(--muted)', flex: 1, minWidth: 0 }} aria-live="polite">
          {status === 'saved' ? `Сохранено · ${editedLabel(note.updated_at, now)}` : status === 'saving' ? 'Сохраняем…' : 'Есть несохранённое'}
          {note.author && ` · пишет ${note.author}`}
        </span>
        <button
          className="icon-btn"
          type="button"
          aria-pressed={note.pinned}
          aria-label={note.pinned ? 'Открепить' : 'Закрепить на главной'}
          title={note.pinned ? 'Открепить' : 'Закрепить на главной'}
          style={note.pinned ? { color: 'var(--accent-ink)', borderColor: 'var(--accent)' } : undefined}
          onClick={() => change({ pinned: !note.pinned }, true)}
        >
          <Icon name="pin" size={18} />
        </button>
        {mine && (
          <button className="icon-btn" type="button" aria-label="Удалить заметку" onClick={() => setConfirm(true)}>
            <Icon name="trash" size={18} />
          </button>
        )}
      </div>

      <label className="sr-only" htmlFor="note-title">
        Заголовок
      </label>
      <input
        id="note-title"
        className="note-title display"
        placeholder="Заголовок"
        maxLength={200}
        value={title}
        onChange={(e) => {
          setTitle(e.target.value);
          change({ title: e.target.value });
        }}
      />
      <label className="sr-only" htmlFor="note-body">
        Текст заметки
      </label>
      <textarea
        id="note-body"
        ref={bodyRef}
        className="note-body"
        placeholder="Текст. Списки — строками с «- » в начале."
        value={body}
        onChange={(e) => {
          setBody(e.target.value);
          change({ body: e.target.value });
        }}
      />

      <div className="note-meta">
        <div className="fld" style={{ flex: '2 1 220px' }}>
          <label className="label" htmlFor="note-tags">
            Метки через запятую
          </label>
          <input
            id="note-tags"
            className="field"
            placeholder="дом, поездки"
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            onBlur={() => {
              const t = parseTags(tags);
              setTags(t.join(', '));
              if (t.join(',') !== note.tags.join(',')) change({ tags: t }, true);
            }}
          />
        </div>
        <div className="fld" style={{ flex: '1 1 180px' }}>
          <label className="label" htmlFor="note-list">
            К чек-листу
          </label>
          <select id="note-list" className="field" value={note.checklist_id ?? ''} onChange={(e) => change({ checklist_id: e.target.value || null }, true)}>
            <option value="">Нет</option>
            {data.checklists.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        {data.household && mine && (
          <label className="check" style={{ alignSelf: 'flex-end' }}>
            <input type="checkbox" checked={!!note.household_id} onChange={(e) => change({ shared: e.target.checked }, true)} />
            <span className="check-text">Общая для семьи</span>
          </label>
        )}
      </div>

      <NoteTasks noteId={note.id} />

      {confirm && (
        <Confirm title={`Удалить «${noteTitle({ title, body })}»?`} text="Заметка удалится насовсем." action="Удалить" onCancel={() => setConfirm(false)} onConfirm={remove} />
      )}
    </article>
  );
}

/** Заметки: список с поиском и метками, рядом — открытая заметка. */
export default function Notes() {
  const { data, reload, now, toast } = useApp();
  const params = useSearchParams();
  const router = useRouter();
  const [sel, setSel] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [tag, setTag] = useState<string | null>(null);

  // Пришли из поиска: /notes?open=<id>.
  useEffect(() => {
    const id = params.get('open');
    if (id) setSel(id);
  }, [params]);

  const select = (id: string | null) => {
    setSel(id);
    router.replace(id ? `/notes?open=${id}` : '/notes', { scroll: false });
  };

  const create = async () => {
    try {
      const r = await api<{ id: string }>('notes', 'POST', { tags: tag ? [tag] : [] });
      await reload();
      select(r.id);
      setTimeout(() => document.getElementById('note-title')?.focus(), 50);
    } catch (err) {
      toast((err as Error).message);
    }
  };

  const needle = normalize(q.trim().toLowerCase());
  const list = data.notes.filter(
    (n) => (!tag || n.tags.includes(tag)) && (!needle || normalize(`${n.title}\n${n.body}`.toLowerCase()).includes(needle)),
  );
  const tags = [...new Set(data.notes.flatMap((n) => n.tags))].sort();
  const open = data.notes.find((n) => n.id === sel) ?? null;
  const phone = useIsPhone();

  return (
    <>
      <div className="page-head">
        <h1 className="h1 display" style={{ flex: 1 }}>
          Заметки
        </h1>
        <button className="btn btn-primary hide-phone" type="button" onClick={create}>
          <Icon name="plus" size={18} />
          Новая заметка
        </button>
      </div>
      {/* На телефоне «создать» — всегда круглая «+» внизу справа. */}
      {phone && !open && <Fab label="Новая заметка" onClick={create} />}
      <div className="notes-layout" data-detail={open ? 'true' : 'false'}>
        <aside className="notes-aside">
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 12, top: 12, color: 'var(--muted)' }}>
              <Icon name="search" size={18} />
            </span>
            <label className="sr-only" htmlFor="notes-q">
              Найти в заметках
            </label>
            <input id="notes-q" className="field" style={{ paddingLeft: 40 }} placeholder="Найти в заметках" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          {tags.length > 0 && (
            <div role="group" aria-label="Метки" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <button className="chip" type="button" aria-pressed={!tag} onClick={() => setTag(null)}>
                Все
              </button>
              {tags.map((t) => (
                <button key={t} className="chip" type="button" aria-pressed={tag === t} onClick={() => setTag(tag === t ? null : t)}>
                  {t}
                </button>
              ))}
            </div>
          )}
          {list.length === 0 ? (
            data.notes.length ? (
              <p style={{ margin: 0, color: 'var(--muted)' }}>Ничего не нашлось.</p>
            ) : (
              <Empty icon="note" title="Мысли, списки, идеи подарков" action="Написать первую заметку" onAction={create} />
            )
          ) : (
            list.map((n) => (
              <button key={n.id} type="button" className="note-card" aria-current={n.id === sel ? 'true' : undefined} onClick={() => select(n.id)}>
                <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  {n.pinned && <Icon name="pin" size={14} />}
                  <span style={{ fontWeight: 600, flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{noteTitle(n)}</span>
                  <span style={{ fontSize: 'calc(12px * var(--fs))', color: 'var(--muted)', flex: 'none' }}>{editedLabel(n.updated_at, now)}</span>
                </span>
                <span className="note-preview">{(n.title.trim() ? n.body : n.body.split('\n').slice(1).join(' ')).trim() || ' '}</span>
                {(n.tags.length > 0 || n.household_id) && (
                  <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {n.household_id && (
                      <span className="tag">
                        <Icon name="users" size={12} /> {n.author ?? 'общая'}
                      </span>
                    )}
                    {n.tags.map((t) => (
                      <span key={t} className="tag">
                        {t}
                      </span>
                    ))}
                  </span>
                )}
              </button>
            ))
          )}
        </aside>
        <div className="notes-main">
          {open ? (
            <Editor key={open.id} note={open} onBack={() => select(null)} onDeleted={() => select(null)} />
          ) : (
            <div className="panel" style={{ padding: 28, color: 'var(--muted)' }}>
              Выберите заметку слева или создайте новую.
            </div>
          )}
        </div>
      </div>
    </>
  );
}
