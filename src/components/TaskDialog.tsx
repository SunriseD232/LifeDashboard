'use client';

import { useEffect, useRef, useState } from 'react';
import type { QuickItem } from '@/lib/aiParse';
import { api } from '@/lib/api';
import { localDay } from '@/lib/dates';
import { describe, type Rule } from '@/lib/recur';
import { knownTags, PRIORITIES, shortDate, type Task } from '@/lib/tasks';
import type { Priority, Reminder } from '@/lib/types';
import { useApp } from './AppShell';
import Confirm from './Confirm';
import { Icon } from './icons';
import { Sheet, useIsPhone } from './Phone';
import RuleEditor from './RuleEditor';
import { useModalFocus } from './useModalFocus';

/**
 * Окно «Задача» — одно на создание и правку. Вид: без напоминания (просто
 * список) или с напоминанием (день, время, повтор — RuleEditor). У обоих —
 * метки, важность, чек-лист и заметка. При создании сверху — ввод своими
 * словами (ИИ): одна задача заполняет форму, несколько — список на выбор.
 */

type Kind = 'task' | 'rem';

interface Draft {
  kind: Kind;
  title: string;
  note: string;
  tags: string[];
  priority: Priority;
  checklist_id: string;
  shared: boolean;
  rule: Rule;
  times: string[];
  nag: number;
}

export type DialogTarget = { task: Task } | { reminder: Reminder } | { day?: string; title?: string; time?: string } | null;

function draftOf(target: NonNullable<DialogTarget>, today: string, at: string): Draft {
  const base: Draft = { kind: 'task', title: '', note: '', tags: [], priority: 0, checklist_id: '', shared: false, rule: { kind: 'once', date: today }, times: [at], nag: 0 };
  if ('task' in target) {
    const t = target.task;
    return { ...base, title: t.title, note: t.note ?? '', tags: t.tags, priority: t.priority, checklist_id: t.checklist_id ?? '', shared: !!t.household_id };
  }
  if ('reminder' in target) {
    const r = target.reminder;
    return { ...base, kind: 'rem', title: r.title, note: r.note ?? '', tags: r.tags, priority: r.priority, checklist_id: r.checklist_id ?? '', rule: r.rule, times: r.times, nag: r.nag ?? 0 };
  }
  const day = target.day && target.day >= today ? target.day : null;
  return { ...base, kind: day ? 'rem' : 'task', title: target.title ?? '', rule: { kind: 'once', date: day ?? today }, times: [target.time ?? at] };
}

/** Ближайший целый час, но не раньше времени из настроек: напоминание не в прошлом. */
function defaultTime(now: Date, setting: string): string {
  const next = `${String(Math.min(23, now.getHours() + 1)).padStart(2, '0')}:00`;
  return next > setting ? next : setting;
}

/** Флажок важности: высокая — красный, средняя — оранжевый, низкая — синий. */
export function PriorityFlag({ p, size = 14 }: { p: Priority; size?: number }) {
  if (!p) return null;
  return (
    <span className="prio" data-p={p} title={`Важность: ${PRIORITIES[p].short}`} aria-label={`Важность: ${PRIORITIES[p].short}`}>
      <Icon name="flag" size={size} />
    </span>
  );
}

/** Сохранить предложенное ИИ обычными запросами. */
export async function saveQuickItems(items: QuickItem[]): Promise<void> {
  const shopping = items.filter((i): i is Extract<QuickItem, { type: 'shopping' }> => i.type === 'shopping');
  for (const it of items) {
    if (it.type === 'task') await api('tasks', 'POST', { title: it.title, tags: it.tags, priority: it.priority });
    if (it.type === 'reminder') await api('reminders', 'POST', { title: it.title, times: it.times, rule: it.rule, checklist_id: null, tags: it.tags, priority: it.priority });
    if (it.type === 'note') await api('notes', 'POST', { title: it.title, body: it.body });
  }
  if (shopping.length) await api('kitchen/shopping', 'POST', { items: shopping.map((s) => ({ name: s.name, qty: s.qty, unit: s.unit })) });
}

export function quickLabel(it: QuickItem, today: string): { kind: string; icon: string; text: string; meta: string } {
  switch (it.type) {
    case 'task':
      return { kind: 'Задача', icon: 'tasks', text: it.title, meta: [PRIORITIES[it.priority].short && `важность ${PRIORITIES[it.priority].short}`, ...it.tags.map((t) => `#${t}`)].filter(Boolean).join(' · ') };
    case 'reminder':
      return {
        kind: 'С напоминанием',
        icon: 'bell',
        text: it.title,
        meta: [it.rule.kind === 'once' ? `${shortDate(it.rule.date, today)}, в ${it.times.join(', ')}` : `${describe(it.rule)}, в ${it.times.join(', ')}`, PRIORITIES[it.priority].short && `важность ${PRIORITIES[it.priority].short}`, ...it.tags.map((t) => `#${t}`)]
          .filter(Boolean)
          .join(' · '),
      };
    case 'note':
      return { kind: 'Заметка', icon: 'note', text: it.title || it.body.slice(0, 60), meta: it.title ? it.body.slice(0, 80) : '' };
    case 'shopping':
      return { kind: 'Покупка', icon: 'cart', text: it.name, meta: it.qty ? `${it.qty} ${it.unit ?? ''}` : '' };
  }
}

/** Метки: свои — нажатием, новая — вписать и Enter. */
export function TagPicker({ value, onChange, known }: { value: string[]; onChange: (v: string[]) => void; known: string[] }) {
  const [adding, setAdding] = useState('');
  const has = (t: string) => value.some((v) => v.toLowerCase() === t.toLowerCase());
  const toggle = (t: string) => onChange(has(t) ? value.filter((v) => v.toLowerCase() !== t.toLowerCase()) : [...value, t]);
  const all = [...known, ...value.filter((v) => !known.some((k) => k.toLowerCase() === v.toLowerCase()))];
  const add = () => {
    const t = adding.trim().replace(/^#/, '').slice(0, 30);
    if (t && !has(t)) onChange([...value, t]);
    setAdding('');
  };
  return (
    <div className="tag-picker">
      {all.map((t) => (
        <button key={t} type="button" className="chip" aria-pressed={has(t)} onClick={() => toggle(t)}>
          #{t}
        </button>
      ))}
      <span className="tag-new">
        <label className="sr-only" htmlFor="tag-new">
          Новая метка
        </label>
        <input
          id="tag-new"
          className="field"
          maxLength={30}
          placeholder="+ новая метка"
          value={adding}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              add();
            }
          }}
          onBlur={add}
        />
      </span>
    </div>
  );
}

export function PriorityPicker({ value, onChange }: { value: Priority; onChange: (p: Priority) => void }) {
  return (
    <div className="seg seg-4" role="group" aria-label="Важность">
      {PRIORITIES.map((p) => (
        <button key={p.v} type="button" aria-pressed={value === p.v} onClick={() => onChange(p.v)}>
          {p.v > 0 && <PriorityFlag p={p.v} />}
          {p.label}
        </button>
      ))}
    </div>
  );
}

export default function TaskDialog({ target, onClose }: { target: NonNullable<DialogTarget>; onClose: () => void }) {
  const { data, reload, toast, now, mutate } = useApp();
  const today = localDay(now);
  const phone = useIsPhone();
  const at = defaultTime(now, data.settings.deadline_time);
  const [d, setD] = useState<Draft>(() => draftOf(target, today, at));
  const [ruleKey, setRuleKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  useModalFocus(formRef);

  const editing = 'task' in target ? target.task : 'reminder' in target ? target.reminder : null;
  const wasKind: Kind | null = 'task' in target ? 'task' : 'reminder' in target ? 'rem' : null;
  // Чужую общую задачу нельзя удалить — значит, и перевести в напоминание.
  const foreign = 'task' in target && !!target.task.author;
  const known = knownTags(data.tags, data.tasks, data.reminders);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !phone && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, phone]);

  const bodyOf = () => {
    const common = { title: d.title.trim(), note: d.note.trim() || null, tags: d.tags, priority: d.priority, checklist_id: d.checklist_id || null };
    return d.kind === 'task' ? { ...common, shared: d.shared } : { ...common, title: common.title.slice(0, 120), times: d.times, rule: d.rule, nag: d.nag || null };
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.title.trim() || (d.kind === 'rem' && (d.times.length === 0 || d.times.some((t) => !t)))) return;
    setBusy(true);
    const path = d.kind === 'task' ? 'tasks' : 'reminders';
    try {
      if (editing && wasKind === d.kind) await api(`${path}/${editing.id}`, 'PATCH', bodyOf());
      else {
        await api(path, 'POST', bodyOf());
        // Сменили вид — заводим заново и убираем прежнюю.
        if (editing) await api(`${wasKind === 'task' ? 'tasks' : 'reminders'}/${editing.id}`, 'DELETE');
      }
      await reload();
      toast(editing ? 'Задача сохранена' : d.kind === 'rem' ? `Напомню ${d.rule.kind === 'once' ? `${shortDate(d.rule.date, today)} в ${d.times[0]}` : `в ${d.times[0]}`}` : 'Задача добавлена');
      onClose();
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  };

  const remove = () => {
    if (!editing) return;
    const id = editing.id;
    if (wasKind === 'task') mutate((x) => ({ ...x, tasks: x.tasks.filter((t) => t.id !== id) }), () => api(`tasks/${id}`, 'DELETE'));
    else
      mutate(
        (x) => ({ ...x, reminders: x.reminders.filter((r) => r.id !== id), done: x.done.filter((k) => !k.startsWith(`${id}@`)), snoozed: x.snoozed.filter((s) => s.reminder_id !== id) }),
        () => api(`reminders/${id}`, 'DELETE'),
      );
    toast(`Удалено: «${editing.title}»`);
    onClose();
  };

  if (confirm && editing) {
    const r = 'reminder' in target ? target.reminder : null;
    return (
      <Confirm
        title={`Удалить «${editing.title}»?`}
        text={r && r.rule.kind !== 'once' ? `Повтор «${describe(r.rule)}» удалится целиком, со всеми отметками.` : 'Задача удалится насовсем.'}
        action="Удалить"
        onCancel={() => setConfirm(false)}
        onConfirm={remove}
      />
    );
  }

  const fields = (
    <>
      {!editing && data.ai && (
        <AiFill
          onOne={(it) => {
            if (it.type === 'task') set({ kind: 'task', title: it.title, tags: it.tags, priority: it.priority });
            else if (it.type === 'reminder') {
              set({ kind: 'rem', title: it.title, tags: it.tags, priority: it.priority, rule: it.rule, times: it.times });
              setRuleKey((k) => k + 1);
            }
          }}
          onSaved={onClose}
        />
      )}
      <div className="fld">
        <label className="label" htmlFor="td-title">
          Что сделать
        </label>
        <input id="td-title" className="field" maxLength={d.kind === 'rem' ? 120 : 200} autoFocus={!phone} placeholder="Например, «Отнести куртку в химчистку»" value={d.title} onChange={(e) => set({ title: e.target.value })} />
      </div>

      <div className="seg seg-2" role="group" aria-label="Вид задачи">
        <button type="button" aria-pressed={d.kind === 'task'} disabled={foreign} onClick={() => set({ kind: 'task' })}>
          <Icon name="tasks" size={16} />
          Без напоминания
        </button>
        <button type="button" aria-pressed={d.kind === 'rem'} disabled={foreign} onClick={() => set({ kind: 'rem' })}>
          <Icon name="bell" size={16} />С напоминанием
        </button>
      </div>

      {d.kind === 'rem' && <RuleEditor key={ruleKey} rule={d.rule} times={d.times} today={today} onChange={(rule, times) => set({ rule, times })} />}

      <div className="fld">
        <span className="label">Метки</span>
        <TagPicker value={d.tags} onChange={(tags) => set({ tags })} known={known} />
      </div>

      <div className="fld">
        <span className="label">Важность</span>
        <PriorityPicker value={d.priority} onChange={(priority) => set({ priority })} />
      </div>

      <div className="fld">
        <label className="label" htmlFor="td-list">
          Чек-лист
        </label>
        <select id="td-list" className="field" value={d.checklist_id} onChange={(e) => set({ checklist_id: e.target.value })}>
          <option value="">Без чек-листа</option>
          {data.checklists.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </select>
      </div>

      <details className="more-opts" open={!!d.note || undefined}>
        <summary>{d.kind === 'rem' ? 'Ещё: заметка, повтор push, если не отметили' : data.household ? 'Ещё: заметка, общая для семьи' : 'Ещё: заметка'}</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>
          <div className="fld">
            <label className="label" htmlFor="td-note">
              Заметка
            </label>
            <textarea id="td-note" className="field" rows={3} maxLength={2000} value={d.note} onChange={(e) => set({ note: e.target.value })} />
          </div>
          {d.kind === 'rem' && (
            <div className="fld">
              <label className="label" htmlFor="td-nag">
                Если не отметили «Сделано»
              </label>
              <select id="td-nag" className="field" value={d.nag} onChange={(e) => set({ nag: Number(e.target.value) })}>
                <option value={0}>Не повторять</option>
                <option value={15}>Напомнить ещё раз через 15 минут</option>
                <option value={30}>Напомнить ещё раз через 30 минут</option>
                <option value={60}>Напомнить ещё раз через час</option>
              </select>
            </div>
          )}
          {d.kind === 'task' && data.household && (
            <label className="check" style={{ padding: 0 }}>
              <input type="checkbox" checked={d.shared} disabled={foreign} onChange={(e) => set({ shared: e.target.checked })} />
              <span className="check-text">Общая для семьи</span>
            </label>
          )}
        </div>
      </details>

      {foreign && <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>Общая задача, завёл(а) {(target as { task: Task }).task.author}.</p>}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        {editing && !foreign && (
          <button className="btn btn-danger-ghost" type="button" onClick={() => setConfirm(true)}>
            <Icon name="trash" size={18} />
            Удалить
          </button>
        )}
        <span style={{ flex: 1 }} />
        <button className="btn btn-ghost hide-phone" type="button" onClick={onClose}>
          Отмена
        </button>
        <button className="btn btn-primary" type="submit" disabled={busy || !d.title.trim()}>
          <Icon name={editing ? 'check' : 'plus'} size={18} />
          {busy ? 'Сохраняем…' : editing ? 'Сохранить' : 'Добавить'}
        </button>
      </div>
    </>
  );

  const title = editing ? 'Задача' : 'Новая задача';
  if (phone) {
    return (
      <Sheet title={title} onClose={onClose}>
        <form ref={formRef} onSubmit={save} className="task-dialog">
          {fields}
        </form>
      </Sheet>
    );
  }
  return (
    <div className="overlay" onClick={onClose}>
      <form ref={formRef} className="dialog task-dialog" role="dialog" aria-modal="true" aria-labelledby="td-head" style={{ width: 'min(560px, 100%)' }} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <h2 id="td-head" className="display" style={{ margin: 0, fontSize: 20 }}>
          {title}
        </h2>
        {fields}
      </form>
    </div>
  );
}

/**
 * Своими словами (ИИ): «завтра в 9 позвонить врачу, срочно». Одна задача —
 * заполняет форму ниже (проверить и сохранить); несколько записей —
 * список: отметить нужное и добавить разом или открыть одну в форме.
 */
function AiFill({ onOne, onSaved }: { onOne: (it: QuickItem) => void; onSaved: () => void }) {
  const { reload, toast, now } = useApp();
  const today = localDay(now);
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState<QuickItem[] | null>(null);
  const [pick, setPick] = useState<boolean[]>([]);

  const parse = async () => {
    if (!text.trim()) return;
    setBusy(true);
    try {
      const r = await api<{ items: QuickItem[] }>('ai/quick-add', 'POST', { text, today });
      const one = r.items.length === 1 && (r.items[0].type === 'task' || r.items[0].type === 'reminder');
      if (one) {
        onOne(r.items[0]);
        setItems(null);
        toast('Заполнил форму — проверьте и добавьте');
      } else {
        setItems(r.items);
        setPick(r.items.map(() => true));
      }
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const saveAll = async () => {
    if (!items) return;
    setBusy(true);
    try {
      await saveQuickItems(items.filter((_, i) => pick[i]));
      await reload();
      toast(`Добавлено: ${pick.filter(Boolean).length}`);
      onSaved();
    } catch (err) {
      toast((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <div className="ai-fill">
      <div className="add-row" style={{ flexWrap: 'nowrap' }}>
        <label className="sr-only" htmlFor="td-ai">
          Своими словами
        </label>
        <input
          id="td-ai"
          className="field"
          style={{ flex: 1 }}
          maxLength={1000}
          placeholder="Своими словами: «завтра в 9 позвонить врачу, срочно»"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              parse();
            }
          }}
        />
        <button className="btn btn-ai" type="button" disabled={busy || !text.trim()} onClick={parse} aria-label="Разобрать фразу (ИИ)" title="Разобрать: дата, время, повтор, метки, важность">
          <Icon name="sparkles" size={18} />
          <span className="btn-text">{busy && !items ? 'Думаю…' : 'Разобрать'}</span>
        </button>
      </div>
      {items && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          {items.map((it, i) => {
            const l = quickLabel(it, today);
            const editable = it.type === 'task' || it.type === 'reminder';
            return (
              <div key={i} className="ai-item">
                <label className="check" style={{ padding: '6px 4px', alignItems: 'flex-start', flex: 1, minWidth: 0 }}>
                  <input type="checkbox" checked={pick[i]} onChange={(e) => setPick(pick.map((p, j) => (j === i ? e.target.checked : p)))} />
                  <span className="check-text">
                    <span className="tag" style={{ marginRight: 6 }}>
                      <Icon name={l.icon} size={12} />
                      {l.kind}
                    </span>
                    <b style={{ fontWeight: 600 }}>{l.text}</b>
                    {l.meta && <span style={{ display: 'block', fontSize: 13, color: 'var(--muted)' }}>{l.meta}</span>}
                  </span>
                </label>
                {editable && (
                  <button
                    className="icon-btn bare"
                    type="button"
                    aria-label={`Открыть «${l.text}» в форме`}
                    title="Открыть в форме"
                    onClick={() => {
                      onOne(it);
                      const rest = items.filter((_, j) => j !== i);
                      setItems(rest.length ? rest : null);
                      setPick(pick.filter((_, j) => j !== i));
                    }}
                  >
                    <Icon name="edit" size={16} />
                  </button>
                )}
              </div>
            );
          })}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button className="btn btn-primary" type="button" disabled={busy || !pick.some(Boolean)} onClick={saveAll}>
              <Icon name="check" size={18} />
              Добавить выбранное ({pick.filter(Boolean).length})
            </button>
            <button className="btn btn-ghost" type="button" onClick={() => setItems(null)}>
              Отмена
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
