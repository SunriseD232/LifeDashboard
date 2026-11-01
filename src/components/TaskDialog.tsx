'use client';

import { useEffect, useRef, useState } from 'react';
import type { QuickItem } from '@/lib/aiParse';
import { api } from '@/lib/api';
import { localDay } from '@/lib/dates';
import { addDays, describe, type Rule } from '@/lib/recur';
import { knownTags, PRIORITIES, shortDate, type Task } from '@/lib/tasks';
import type { Priority, Reminder } from '@/lib/types';
import { useApp } from './AppShell';
import Confirm from './Confirm';
import { Icon } from './icons';
import { Sheet, useIsPhone } from './Phone';
import RuleEditor, { TimesField } from './RuleEditor';
import { useModalFocus } from './useModalFocus';

/**
 * Окно «Задача» — одно на создание и правку. Сразу видно только название и
 * «Когда»: без срока — просто в списке, с днём — напоминание (время
 * подставится само). Повтор, метки, важность, чек-лист, заметка — кнопками
 * «+ …» под формой: пустое не занимает места, заполненное видно всегда.
 *
 * Название — одно поле. С ИИ рядом кнопка «Разобрать»: не нажали — задача
 * сохраняется как написано; нажали — форма заполняется по фразе (ничего не
 * сохраняется, пока не нажмёте «Добавить»).
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
  /** Кто делает (логин) — у общих; '' — все. */
  assignee: string;
  rule: Rule;
  times: string[];
  nag: number;
}

export type DialogTarget = { task: Task } | { reminder: Reminder } | { day?: string; title?: string; time?: string } | null;

/** Необязательные части окна: появляются кнопкой «+ …» или когда заполнены. */
type Extra = 'repeat' | 'tags' | 'priority' | 'checklist' | 'note' | 'nag';

function draftOf(target: NonNullable<DialogTarget>, today: string, at: string): Draft {
  const base: Draft = { kind: 'task', title: '', note: '', tags: [], priority: 0, checklist_id: '', shared: false, assignee: '', rule: { kind: 'once', date: today }, times: [at], nag: 0 };
  if ('task' in target) {
    const t = target.task;
    return { ...base, title: t.title, note: t.note ?? '', tags: t.tags, priority: t.priority, checklist_id: t.checklist_id ?? '', shared: !!t.household_id, assignee: t.assignee ?? '' };
  }
  if ('reminder' in target) {
    const r = target.reminder;
    return {
      ...base,
      kind: 'rem',
      title: r.title,
      note: r.note ?? '',
      tags: r.tags,
      priority: r.priority,
      checklist_id: r.checklist_id ?? '',
      shared: !!r.household_id,
      assignee: r.assignee ?? '',
      rule: r.rule,
      times: r.times,
      nag: r.nag ?? 0,
    };
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
    <span className="prio" data-p={p} title={`Важность: ${PRIORITIES[p].short}`}>
      <Icon name="flag" size={size} />
      <span className="sr-only">{`Важность: ${PRIORITIES[p].short}`}</span>
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
  const [parsing, setParsing] = useState(false);
  // Остальное, что ИИ нашёл во фразе: сохраним вместе с задачей, если отмечено.
  const [extras, setExtras] = useState<{ item: QuickItem; on: boolean }[]>([]);
  const [confirm, setConfirm] = useState(false);
  // Пустое название: вместо молча неактивной кнопки — подсказка у поля.
  const [titleErr, setTitleErr] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  // На телефоне форма лежит в Sheet, и фокусом с Esc ведает уже он.
  useModalFocus(formRef, onClose, !phone);

  const editing = 'task' in target ? target.task : 'reminder' in target ? target.reminder : null;
  const wasKind: Kind | null = 'task' in target ? 'task' : 'reminder' in target ? 'rem' : null;
  // Чужую общую задачу нельзя удалить — значит, и перевести в другой вид:
  // у задачи «Когда» закрыто, у напоминания нельзя убрать срок.
  const foreign = !!editing?.author;
  const foreignTask = foreign && wasKind === 'task';
  const known = knownTags(data.tags, data.tasks, data.reminders);
  const set = (patch: Partial<Draft>) => setD((x) => ({ ...x, ...patch }));

  // «Когда»: без срока — задача, день — разовое напоминание. Время само:
  // сегодня — ближайший час, другой день — время по умолчанию из Настроек.
  const tomorrow = addDays(today, 1);
  const repeating = d.kind === 'rem' && d.rule.kind !== 'once';
  const onceDate = d.kind === 'rem' && d.rule.kind === 'once' ? d.rule.date : null;
  const [pickDate, setPickDate] = useState(() => !!onceDate && onceDate !== today && onceDate !== tomorrow);
  // Время уже выбрано (правка или поменяли руками) — смена дня его не трогает.
  const [timeTouched, setTimeTouched] = useState(!!editing);
  // «Ставить по умолчанию» — только если время поменяли в этом окне.
  const [timeEdited, setTimeEdited] = useState(false);
  const when = (day: string | null) => {
    if (!day) {
      setPickDate(false);
      return set({ kind: 'task' });
    }
    set({ kind: 'rem', rule: { kind: 'once', date: day }, times: timeTouched && d.kind === 'rem' ? d.times : [day === today ? at : data.settings.deadline_time] });
  };
  const setDefaultTime = (t: string) => {
    mutate(
      (x) => ({ ...x, settings: { ...x.settings, deadline_time: t } }),
      () => api('settings', 'PATCH', { deadline_time: t }),
    );
    toast(`Теперь по умолчанию — ${t}`);
  };

  const filled: Record<Extra, boolean> = {
    repeat: repeating,
    tags: d.tags.length > 0,
    priority: d.priority > 0,
    checklist: !!d.checklist_id,
    note: !!d.note,
    nag: d.kind === 'rem' && d.nag > 0,
  };
  const [opened, setOpened] = useState<Extra[]>([]);
  const [focusExtra, setFocusExtra] = useState<Extra | null>(null);
  const shown = (x: Extra) => filled[x] || opened.includes(x);
  const open = (x: Extra) => {
    setOpened((o) => [...o, x]);
    setFocusExtra(x);
  };
  const drop = (x: Extra, patch: Partial<Draft>) => {
    setOpened((o) => o.filter((y) => y !== x));
    set(patch);
  };
  // Открыли «+ Метка» и т. п. — фокус сразу в новое поле.
  useEffect(() => {
    if (!focusExtra) return;
    formRef.current?.querySelector<HTMLElement>(`[data-extra="${focusExtra}"] :is(input, select, textarea, button:not(.td-drop))`)?.focus();
    setFocusExtra(null);
  }, [focusExtra]);

  /** «Разобрать»: фраза из поля названия → заполненная форма. */
  const parse = async () => {
    if (!d.title.trim()) return;
    setParsing(true);
    try {
      const r = await api<{ items: QuickItem[] }>('ai/quick-add', 'POST', { text: d.title, today });
      const main = r.items.find((i) => i.type === 'task' || i.type === 'reminder');
      if (main?.type === 'task') set({ kind: 'task', title: main.title, tags: main.tags, priority: main.priority });
      else if (main?.type === 'reminder') {
        set({ kind: 'rem', title: main.title, tags: main.tags, priority: main.priority, rule: main.rule, times: main.times });
        setRuleKey((k) => k + 1);
      }
      setExtras(r.items.filter((i) => i !== main).map((item) => ({ item, on: true })));
      toast(main ? 'Заполнил по фразе — проверьте и добавьте' : 'Задачи во фразе не нашёл — ниже то, что нашёл');
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setParsing(false);
    }
  };

  const bodyOf = () => {
    const common = { title: d.title.trim().slice(0, 200), note: d.note.trim() || null, tags: d.tags, priority: d.priority, checklist_id: d.checklist_id || null, shared: d.shared, assignee: d.shared ? d.assignee || null : null };
    return d.kind === 'task' ? common : { ...common, title: common.title.slice(0, 120), times: d.times, rule: d.rule, nag: d.nag || null };
  };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!d.title.trim()) {
      setTitleErr(true);
      document.getElementById('td-title')?.focus();
      return;
    }
    if ((d.kind === 'rem' && (d.times.length === 0 || d.times.some((t) => !t)))) return;
    setBusy(true);
    const path = d.kind === 'task' ? 'tasks' : 'reminders';
    try {
      if (editing && wasKind === d.kind) await api(`${path}/${editing.id}`, 'PATCH', bodyOf());
      else {
        await api(path, 'POST', bodyOf());
        // Сменили вид — заводим заново и убираем прежнюю.
        if (editing) await api(`${wasKind === 'task' ? 'tasks' : 'reminders'}/${editing.id}`, 'DELETE');
      }
      const more = extras.filter((x) => x.on).map((x) => x.item);
      if (more.length) await saveQuickItems(more);
      await reload();
      toast(
        editing
          ? 'Задача сохранена'
          : `${d.kind === 'rem' ? `Напомню ${d.rule.kind === 'once' ? `${shortDate(d.rule.date, today)} в ${d.times[0]}` : `в ${d.times[0]}`}` : 'Задача добавлена'}${more.length ? ` (и ещё ${more.length})` : ''}`,
      );
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

  // Подтверждение — поверх окна задачи, а не вместо: «Оставить» и Esc
  // возвращают в окно с правками, фокус — на «Удалить».
  const r = 'reminder' in target ? target.reminder : null;
  const confirmEl = confirm && editing && (
      <Confirm
        title={`Удалить «${editing.title}»?`}
        text={r && r.rule.kind !== 'once' ? `Повтор «${describe(r.rule)}» удалится целиком, со всеми отметками.` : 'Задача удалится насовсем.'}
        action="Удалить"
        onCancel={() => setConfirm(false)}
        onConfirm={remove}
      />
  );

  const ai = !editing && !!data.ai;
  const fields = (
    <>
      <div className="fld">
        <label className="label" htmlFor="td-title">
          Что сделать
        </label>
        <div className="add-row" style={{ flexWrap: 'nowrap' }}>
          <input
            id="td-title"
            className="field"
            style={{ flex: 1 }}
            maxLength={ai ? 1000 : d.kind === 'rem' ? 120 : 200}
            autoFocus={!phone}
            placeholder={ai ? 'Например, «завтра в 9 позвонить врачу, срочно»' : 'Например, «Отнести куртку в химчистку»'}
            value={d.title}
            aria-invalid={titleErr || undefined}
            aria-describedby={titleErr ? 'td-title-err' : undefined}
            onChange={(e) => {
              set({ title: e.target.value });
              if (titleErr) setTitleErr(false);
            }}
          />
          {ai && (
            <button className="btn btn-ai" type="button" disabled={parsing || !d.title.trim()} onClick={parse} title="Заполнить форму по фразе: дата, время, повтор, метки, важность">
              <Icon name="sparkles" size={18} />
              <span className="btn-text">{parsing ? 'Думаю…' : 'Разобрать'}</span>
            </button>
          )}
        </div>
        {titleErr && (
          <p id="td-title-err" className="field-err">
            Напишите, что сделать — без названия задачу не сохранить.
          </p>
        )}
      </div>

      {extras.length > 0 && (
        <div className="ai-fill">
          <span className="label">Заодно добавить</span>
          {extras.map((x, i) => {
            const l = quickLabel(x.item, today);
            return (
              <label key={i} className="check" style={{ padding: '4px', alignItems: 'flex-start' }}>
                <input type="checkbox" checked={x.on} onChange={(e) => setExtras(extras.map((y, j) => (j === i ? { ...y, on: e.target.checked } : y)))} />
                <span className="check-text">
                  <span className="tag" style={{ marginRight: 6 }}>
                    <Icon name={l.icon} size={12} />
                    {l.kind}
                  </span>
                  <b style={{ fontWeight: 600 }}>{l.text}</b>
                  {l.meta && <span style={{ display: 'block', fontSize: 'calc(13px * var(--fs))', color: 'var(--muted)' }}>{l.meta}</span>}
                </span>
              </label>
            );
          })}
        </div>
      )}

      {!repeating && (
        <fieldset className="td-when" disabled={foreignTask}>
          <legend className="label">Когда</legend>
          <div className="td-chips">
            <button type="button" className="chip" aria-pressed={!onceDate} disabled={foreign} onClick={() => when(null)}>
              Без срока
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={!pickDate && onceDate === today}
              onClick={() => {
                setPickDate(false);
                when(today);
              }}
            >
              Сегодня
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={!pickDate && onceDate === tomorrow}
              onClick={() => {
                setPickDate(false);
                when(tomorrow);
              }}
            >
              Завтра
            </button>
            <button
              type="button"
              className="chip"
              aria-pressed={pickDate}
              onClick={() => {
                setPickDate(true);
                if (!onceDate) when(addDays(today, 2));
                setTimeout(() => document.getElementById('td-date')?.focus(), 0);
              }}
            >
              <Icon name="calendar" size={14} />
              Дата…
            </button>
          </div>
          {onceDate && (
            <div className="td-when-detail">
              {pickDate && (
                <div className="fld">
                  <label className="label" htmlFor="td-date">
                    День
                  </label>
                  <input id="td-date" className="field" type="date" min={today} value={onceDate} onChange={(e) => e.target.value && when(e.target.value)} />
                </div>
              )}
              <TimesField
                times={d.times}
                onChange={(times) => {
                  setTimeTouched(true);
                  setTimeEdited(true);
                  set({ times });
                }}
                after={
                  timeEdited &&
                  d.times.length === 1 &&
                  !!d.times[0] &&
                  d.times[0] !== data.settings.deadline_time && (
                    <button type="button" className="td-link" onClick={() => setDefaultTime(d.times[0])}>
                      Ставить {d.times[0]} по умолчанию
                    </button>
                  )
                }
              />
            </div>
          )}
        </fieldset>
      )}

      {repeating && (
        <ExtraBlock id="repeat" label="Повтор" onDrop={() => drop('repeat', { rule: { kind: 'once', date: d.rule.kind === 'once' ? d.rule.date : d.rule.start >= today ? d.rule.start : today } })}>
          <RuleEditor key={ruleKey} repeatOnly rule={d.rule} times={d.times} today={today} onChange={(rule, times) => set({ rule, times })} />
        </ExtraBlock>
      )}

      {shown('tags') && (
        <ExtraBlock id="tags" label="Метки" onDrop={() => drop('tags', { tags: [] })}>
          <TagPicker value={d.tags} onChange={(tags) => set({ tags })} known={known} />
        </ExtraBlock>
      )}

      {shown('priority') && (
        <ExtraBlock id="priority" label="Важность" onDrop={() => drop('priority', { priority: 0 })}>
          <PriorityPicker value={d.priority} onChange={(priority) => set({ priority })} />
        </ExtraBlock>
      )}

      {shown('checklist') && (
        <ExtraBlock id="checklist" label="Чек-лист" htmlFor="td-list" onDrop={() => drop('checklist', { checklist_id: '' })}>
          <select id="td-list" className="field" value={d.checklist_id} onChange={(e) => set({ checklist_id: e.target.value })}>
            <option value="">Без чек-листа</option>
            {data.checklists.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </ExtraBlock>
      )}

      {shown('note') && (
        <ExtraBlock id="note" label="Заметка" htmlFor="td-note" onDrop={() => drop('note', { note: '' })}>
          <textarea id="td-note" className="field" rows={3} maxLength={2000} value={d.note} onChange={(e) => set({ note: e.target.value })} />
        </ExtraBlock>
      )}

      {d.kind === 'rem' && shown('nag') && (
        <ExtraBlock id="nag" label="Если не отметили «Сделано»" htmlFor="td-nag" onDrop={() => drop('nag', { nag: 0 })}>
          <select id="td-nag" className="field" value={d.nag} onChange={(e) => set({ nag: Number(e.target.value) })}>
            <option value={0}>Не повторять</option>
            <option value={15}>Напомнить ещё раз через 15 минут</option>
            <option value={30}>Напомнить ещё раз через 30 минут</option>
            <option value={60}>Напомнить ещё раз через час</option>
          </select>
        </ExtraBlock>
      )}

      <AddChips
        items={[
          !repeating && !foreign && { id: 'repeat', label: 'Повтор' },
          !shown('tags') && { id: 'tags', label: 'Метка' },
          !shown('priority') && { id: 'priority', label: 'Важность' },
          !shown('checklist') && data.checklists.length > 0 && { id: 'checklist', label: 'Чек-лист' },
          !shown('note') && { id: 'note', label: 'Заметка' },
          d.kind === 'rem' && !shown('nag') && { id: 'nag', label: 'Напомнить снова' },
        ]}
        onAdd={(x) => {
          if (x === 'repeat') {
            // Повтор — это напоминание: с выбранного дня или с сегодня, время прежнее.
            set({ kind: 'rem', rule: { kind: 'repeat', unit: 'day', every: 1, start: onceDate ?? today }, times: d.kind === 'rem' ? d.times : [at] });
            setRuleKey((k) => k + 1);
          }
          open(x);
        }}
      >
        {data.household && (
          <button type="button" className="chip" aria-pressed={d.shared} disabled={foreign} onClick={() => set({ shared: !d.shared })}>
            <Icon name="users" size={14} />
            Общая для семьи
          </button>
        )}
      </AddChips>

      {d.shared && data.household && data.household.members.length > 1 && (
        <div className="fld">
          <label className="label" htmlFor="td-assignee">
            Кто делает
          </label>
          <select id="td-assignee" className="field" value={d.assignee} onChange={(e) => set({ assignee: e.target.value })}>
            <option value="">{d.kind === 'rem' ? 'Все — напомню каждому' : 'Все'}</option>
            {data.household.members.map((m) => (
              <option key={m.login} value={m.login}>
                {m.me ? `${m.login} (вы)` : m.login}
              </option>
            ))}
          </select>
        </div>
      )}

      {foreign && <p style={{ margin: 0, fontSize: 'calc(13px * var(--fs))', color: 'var(--muted)' }}>Общая, завёл(а) {editing!.author}. Удалить может только автор.</p>}

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
        <button className="btn btn-primary" type="submit" disabled={busy || parsing}>
          <Icon name={editing ? 'check' : 'plus'} size={18} />
          {busy ? 'Сохраняем…' : editing ? 'Сохранить' : 'Добавить'}
        </button>
      </div>
    </>
  );

  const title = editing ? 'Задача' : 'Новая задача';
  if (phone) {
    return (
      <>
        <Sheet title={title} onClose={onClose}>
          <form ref={formRef} onSubmit={save} className="task-dialog">
            {fields}
          </form>
        </Sheet>
        {confirmEl}
      </>
    );
  }
  return (
    <>
    <div className="overlay" onClick={onClose}>
      <form ref={formRef} className="dialog task-dialog" role="dialog" aria-modal="true" aria-labelledby="td-head" style={{ width: 'min(560px, 100%)' }} onClick={(e) => e.stopPropagation()} onSubmit={save}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <h2 id="td-head" className="display" style={{ margin: 0, fontSize: 'calc(20px * var(--fs))', flex: 1 }}>
            {title}
          </h2>
        </div>
        {fields}
      </form>
    </div>
    {/* Рядом, а не внутри: клик мимо подтверждения не должен закрыть и окно задачи. */}
    {confirmEl}
    </>
  );
}

/** Необязательная часть окна: подпись, крестик «убрать» и само поле. */
function ExtraBlock({ id, label, htmlFor, onDrop, children }: { id: Extra; label: string; htmlFor?: string; onDrop: () => void; children: React.ReactNode }) {
  return (
    <div className="fld" data-extra={id}>
      <div className="td-extra-head">
        {htmlFor ? (
          <label className="label" htmlFor={htmlFor}>
            {label}
          </label>
        ) : (
          <span className="label">{label}</span>
        )}
        <button type="button" className="icon-btn bare td-drop" aria-label={`Убрать: ${label.toLowerCase()}`} title="Убрать" onClick={onDrop}>
          <Icon name="x" size={16} />
        </button>
      </div>
      {children}
    </div>
  );
}

type AddItem = { id: Extra; label: string };

/** «+ Повтор», «+ Метка»… — то, чего в окне пока нет. */
function AddChips({ items, onAdd, children }: { items: (false | AddItem)[]; onAdd: (x: Extra) => void; children?: React.ReactNode }) {
  const list = items.filter((x): x is AddItem => !!x);
  if (!list.length && !children) return null;
  return (
    <div className="td-chips td-add" role="group" aria-label="Добавить в задачу">
      {list.map((x) => (
        <button key={x.id} type="button" className="chip chip-add" onClick={() => onAdd(x.id)}>
          <Icon name="plus" size={14} />
          {x.label}
        </button>
      ))}
      {children}
    </div>
  );
}
