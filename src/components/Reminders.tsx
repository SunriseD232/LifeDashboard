'use client';

import { useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import { addDays, dayTitle, inMinutes, localDay, minutesOf, plural, weekdayName } from '@/lib/dates';
import { occurrenceKey, occurrencesOn, type Occurrence } from '@/lib/occurrences';
import { dayLabel, describe, diffDays, dueDay, nextOccurrence, WEEKDAY_SHORT, weekday, type Rule } from '@/lib/recur';
import { CHORE_TEMPLATES } from '@/lib/templates';
import type { Reminder } from '@/lib/types';
import type { AppData, Mutate } from './AppShell';
import Confirm from './Confirm';
import PushPanel from './PushPanel';
import RuleEditor from './RuleEditor';
import { Icon } from './icons';
import { Fab, Sheet, useIsPhone } from './Phone';

interface Props {
  data: AppData;
  mutate: Mutate;
  reload: () => Promise<void>;
  now: Date;
  onOpenChecklist: (id: string) => void;
  toast: (m: string) => void;
}

type View = 'today' | 'chores' | 'all';

interface Draft {
  id: string | null;
  title: string;
  times: string[];
  rule: Rule;
  checklist_id: string;
  /** Повтор push, если не отметили: минуты или 0 — не повторять. */
  nag: number;
}

const NOTIFIED_KEY = 'lifedashboard:notified';
const SNOOZES = [15, 60, 180];

function emptyDraft(now: Date, rule?: Rule): Draft {
  // По умолчанию — ближайший целый час, чтобы не листать часы с нуля.
  const h = Math.min(23, now.getHours() + 1);
  return {
    id: null,
    title: '',
    times: [`${String(h).padStart(2, '0')}:00`],
    rule: rule ?? { kind: 'once', date: localDay(now) },
    checklist_id: '',
    nag: 0,
  };
}

const hm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** «сегодня», «завтра», «пт, 9 октября». */
function whenLabel(day: string, today: string): string {
  const n = diffDays(today, day);
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  return `${WEEKDAY_SHORT[weekday(day)]}, ${dayLabel(day)}`;
}

/**
 * Напоминания: «Сегодня» — дела дня по времени (у дела может быть несколько
 * времён, отметка у каждого своя), «Быт по кругу» — повторы «после
 * выполнения» с отсчётом до следующего раза, «Все» — полный список с
 * правилами. Справа (на телефоне — ниже) форма с редактором повтора.
 */
export default function Reminders({ data, mutate, reload, now, onOpenChecklist, toast }: Props) {
  const [view, setView] = useState<View>('today');
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(now));
  const [formKey, setFormKey] = useState(0);
  const [saving, setSaving] = useState(false);
  const phone = useIsPhone();
  const [sheet, setSheet] = useState(false);
  const [confirm, setConfirm] = useState<Reminder | null>(null);
  const [chorePick, setChorePick] = useState<string[]>([]);
  const [addingChores, setAddingChores] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);
  const titleRef = useRef<HTMLInputElement>(null);

  const today = localDay(now);
  const nowMin = now.getHours() * 60 + now.getMinutes();
  const doneSet = new Set(data.done);
  const todays = occurrencesOn(data.reminders, today, doneSet, data.snoozed);
  const doneCount = todays.filter((o) => o.done).length;
  const timeOf = (o: Occurrence) => o.snoozedTo ?? o.slot;
  const next = todays.find((o) => !o.done && minutesOf(timeOf(o)) >= nowMin);
  const tomorrow = addDays(now, 1);
  const tomorrowList = occurrencesOn(data.reminders, localDay(tomorrow));
  const chores = data.reminders.filter((r) => r.rule.kind === 'after');
  const listName = (id: string | null) => data.checklists.find((c) => c.id === id)?.title ?? null;

  // Подсказка в момент дела, пока вкладка открыта. Системное уведомление
  // присылает сервер push'ем (PushPanel, src/lib/push.ts) — здесь только
  // тост. Помним уже показанные, чтобы не повторять при каждом тике.
  useEffect(() => {
    const cur = hm(nowMin);
    let shown: string[] = [];
    try {
      shown = JSON.parse(sessionStorage.getItem(NOTIFIED_KEY) || '[]');
    } catch {
      shown = [];
    }
    for (const o of todays) {
      const key = `${today}:${o.key}:${timeOf(o)}`;
      if (o.done || timeOf(o) !== cur || shown.includes(key)) continue;
      shown.push(key);
      toast(`Пора: ${o.reminder.title}`);
    }
    try {
      sessionStorage.setItem(NOTIFIED_KEY, JSON.stringify(shown.slice(-100)));
    } catch {
      /* приватный режим */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [now]);

  const setDone = (r: Reminder, slot: string, value: boolean) => {
    const key = occurrenceKey(r.id, slot);
    const after = r.rule.kind === 'after';
    mutate(
      (d) => ({
        ...d,
        done: value ? [...d.done.filter((x) => x !== key), key] : d.done.filter((x) => x !== key),
        snoozed: value ? d.snoozed.filter((s) => !(s.reminder_id === r.id && s.slot === slot)) : d.snoozed,
        reminders: after && value ? d.reminders.map((x) => (x.id === r.id ? { ...x, last_done: today } : x)) : d.reminders,
      }),
      async () => {
        await api(`reminders/${r.id}/done`, 'PUT', { day: today, slot, done: value });
        // Сняли отметку у «после выполнения» — прошлую дату знает сервер.
        if (after && !value) await reload();
      },
    );
  };

  const snooze = (o: Occurrence, minutes: number | null) => {
    const at = minutes === null ? null : nowMin + minutes;
    if (at !== null && at >= 24 * 60) {
      toast('Сегодня уже не успеть — отложить можно только в пределах дня.');
      return;
    }
    const atText = at === null ? null : hm(at);
    mutate(
      (d) => ({
        ...d,
        snoozed: [
          ...d.snoozed.filter((s) => !(s.reminder_id === o.reminder.id && s.slot === o.slot)),
          ...(atText ? [{ reminder_id: o.reminder.id, slot: o.slot, at: atText }] : []),
        ],
      }),
      () => api(`reminders/${o.reminder.id}/snooze`, 'POST', { day: today, slot: o.slot, at: atText }),
    );
    if (atText) toast(`Напомним в ${atText}`);
  };

  const openForm = (d: Draft) => {
    setDraft(d);
    setFormKey((k) => k + 1);
    // На телефоне форма — в окне снизу (фокус ставит само окно).
    if (phone) return setSheet(true);
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setTimeout(() => titleRef.current?.focus(), 250);
  };

  const startEdit = (r: Reminder) =>
    openForm({ id: r.id, title: r.title, times: r.times, rule: r.rule, checklist_id: r.checklist_id ?? '', nag: r.nag ?? 0 });

  // Пришли из поиска: /reminders?edit=<id> — открываем его в форме.
  const params = useSearchParams();
  useEffect(() => {
    const id = params.get('edit');
    const r = id ? data.reminders.find((x) => x.id === id) : null;
    if (r) {
      setView('all');
      startEdit(r);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!draft.title.trim() || draft.times.length === 0 || draft.times.some((t) => !t)) return;
    setSaving(true);
    const body = { title: draft.title.trim(), times: draft.times, rule: draft.rule, checklist_id: draft.checklist_id || null, nag: draft.nag || null };
    try {
      if (draft.id) await api(`reminders/${draft.id}`, 'PATCH', body);
      else await api('reminders', 'POST', body);
      await reload();
      toast(draft.id ? 'Напоминание сохранено' : 'Напоминание добавлено');
      setDraft(emptyDraft(now));
      setFormKey((k) => k + 1);
      setSheet(false);
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  /** На телефоне все действия — в одном меню «⋯», чтобы строка была короткой. */
  const closeMenu = (e: React.MouseEvent) => ((e.currentTarget.closest('details') as HTMLDetailsElement).open = false);
  const actions = (r: Reminder, o?: Occurrence) =>
    phone ? (
      <details className="menu">
        <summary className="icon-btn bare" aria-label={`Действия: «${r.title}»`}>
          <Icon name="dots" size={18} />
        </summary>
        <div className="menu-list" role="group" aria-label="Действия">
          {o &&
            !o.done &&
            SNOOZES.map((m) => (
              <button
                key={m}
                type="button"
                onClick={(e) => {
                  closeMenu(e);
                  snooze(o, m);
                }}
              >
                Отложить {m < 60 ? `на ${m} мин` : `на ${m / 60} ч`}
              </button>
            ))}
          <button
            type="button"
            onClick={(e) => {
              closeMenu(e);
              startEdit(r);
            }}
          >
            Изменить
          </button>
          <button
            type="button"
            onClick={(e) => {
              closeMenu(e);
              setConfirm(r);
            }}
          >
            Удалить
          </button>
        </div>
      </details>
    ) : (
    <>
      <button className="icon-btn bare" type="button" aria-label={`Изменить «${r.title}»`} onClick={() => startEdit(r)}>
        <Icon name="edit" size={18} />
      </button>
      <button className="icon-btn bare" type="button" aria-label={`Удалить «${r.title}»`} onClick={() => setConfirm(r)}>
        <Icon name="trash" size={18} />
      </button>
    </>
    );

  const checklistChip = (r: Reminder) => {
    const name = listName(r.checklist_id);
    return name && r.checklist_id ? (
      <button className="chip" type="button" onClick={() => onOpenChecklist(r.checklist_id!)}>
        <Icon name="list" size={14} />
        Чек-лист «{name}»
      </button>
    ) : null;
  };

  // ---------------------------------------------------------------- сегодня
  const todayView =
    todays.length === 0 ? (
      <div className="panel" style={{ padding: 24, color: 'var(--muted)' }}>
        На сегодня дел нет. Добавьте первое напоминание — например, «Собрать сумку в бассейн» на вечер.
      </div>
    ) : (
      <ol style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {todays.map((o) => {
          const r = o.reminder;
          const isNext = next?.key === o.key;
          const t = timeOf(o);
          const past = !o.done && minutesOf(t) < nowMin;
          const overdue = r.rule.kind === 'after' && !o.done && today > dueDay(r.rule, r.last_done);
          return (
            <li key={o.key} className={`rem-row${isNext ? ' next' : ''}`}>
              <span className="mono rem-time" style={{ width: 52, flex: 'none', paddingTop: 1, color: isNext ? 'var(--warm)' : 'var(--muted)' }}>
                {t}
              </span>
              <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <label className={`check${o.done ? ' done' : ''}`} style={{ padding: 0, minHeight: 0, alignItems: 'flex-start', gap: 10 }}>
                  <input type="checkbox" checked={o.done} onChange={(e) => setDone(r, o.slot, e.target.checked)} />
                  <span className="check-text" style={o.done ? undefined : { fontWeight: 600 }}>
                    {r.title}
                  </span>
                </label>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', paddingLeft: 32 }}>
                  <span className="hide-phone" style={{ fontSize: 13, color: 'var(--muted)', display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                    <Icon name="repeat" size={14} />
                    {describe(r.rule)}
                  </span>
                  {checklistChip(r)}
                  {o.snoozedTo && !o.done && (
                    <span className="chip" style={{ cursor: 'default' }}>
                      отложено с {o.slot}
                      <button className="icon-btn bare" type="button" style={{ width: 24, height: 24 }} aria-label="Не откладывать" onClick={() => snooze(o, null)}>
                        <Icon name="x" size={14} />
                      </button>
                    </span>
                  )}
                  {isNext && (
                    <span className="badge" style={{ background: 'var(--surface)' }}>
                      {inMinutes(minutesOf(t) - nowMin)}
                    </span>
                  )}
                  {overdue && <span style={{ fontSize: 13, color: 'var(--danger)' }}>давно пора</span>}
                  {past && !overdue && !phone && <span style={{ fontSize: 13, color: 'var(--warm)' }}>время прошло</span>}
                </div>
              </div>
              <div className="rem-actions">
                {!o.done && !phone && (
                  <details className="menu">
                    <summary className="icon-btn bare" aria-label={`Отложить «${r.title}»`} title="Отложить">
                      <Icon name="clock" size={18} />
                    </summary>
                    <div className="menu-list" role="group" aria-label="Отложить на">
                      {SNOOZES.map((m) => (
                        <button
                          key={m}
                          type="button"
                          onClick={(e) => {
                            (e.currentTarget.closest('details') as HTMLDetailsElement).open = false;
                            snooze(o, m);
                          }}
                        >
                          {m < 60 ? `на ${m} мин` : `на ${m / 60} ч`}
                        </button>
                      ))}
                    </div>
                  </details>
                )}
                {actions(r, o)}
              </div>
            </li>
          );
        })}
      </ol>
    );

  // ---------------------------------------------------------------- быт по кругу
  // Готовые дела, которых ещё нет (по названию).
  const have = new Set(data.reminders.map((r) => r.title.trim().toLowerCase()));
  const choreOffers = CHORE_TEMPLATES.filter((c) => !have.has(c.title.toLowerCase()));
  const addChores = async () => {
    setAddingChores(true);
    try {
      for (const c of CHORE_TEMPLATES.filter((x) => chorePick.includes(x.id))) {
        await api('reminders', 'POST', { title: c.title, times: [c.time], rule: c.rule(today), checklist_id: null });
      }
      setChorePick([]);
      await reload();
      toast('Добавлено');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setAddingChores(false);
    }
  };
  const choreTemplates = choreOffers.length > 0 && (
    <details className="panel" style={{ padding: '12px 16px' }} open={chores.length === 0}>
      <summary style={{ cursor: 'pointer', fontWeight: 600, minHeight: 32 }}>Добавить из готовых · {choreOffers.length}</summary>
      <div style={{ display: 'flex', flexDirection: 'column', marginTop: 6 }}>
        {choreOffers.map((c) => (
          <label key={c.id} className="check" style={{ padding: '6px 4px' }}>
            <input
              type="checkbox"
              checked={chorePick.includes(c.id)}
              onChange={(e) => setChorePick(e.target.checked ? [...chorePick, c.id] : chorePick.filter((x) => x !== c.id))}
            />
            <span className="check-text">
              {c.title}
              <span style={{ color: 'var(--muted)', fontSize: 13 }}>
                {' '}
                — {describe(c.rule(today))}, в {c.time}
              </span>
            </span>
          </label>
        ))}
      </div>
      {choreOffers.some((c) => c.rule(today).kind === 'repeat') && (
        <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--muted)' }}>
          Дела «каждый месяц» идут по календарю — они будут во вкладке «Все» и в «Сегодня» в свой день.
        </p>
      )}
      <button className="btn btn-primary" type="button" style={{ marginTop: 8 }} disabled={!chorePick.length || addingChores} onClick={addChores}>
        <Icon name="plus" size={18} />
        {chorePick.length ? `Добавить выбранные (${chorePick.length})` : 'Отметьте, что добавить'}
      </button>
    </details>
  );
  const choresView = (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>
        Дела, которые повторяются от раза, когда вы их сделали: отметили «Сделано» — отсчёт пошёл заново. Не успели —
        дело висит в «Сегодня», пока не отметите.
      </p>
      {choreTemplates}
      {chores.length === 0 && (
        <div className="panel" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
          <span style={{ color: 'var(--muted)' }}>Пока пусто. Например: стирка через 4 дня после прошлой, полить цветы через 3 дня.</span>
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => openForm({ ...emptyDraft(now, { kind: 'after', unit: 'day', every: 4, start: today }), title: 'Стирка', times: ['20:00'] })}
          >
            <Icon name="plus" size={18} />
            Стирка через 4 дня
          </button>
        </div>
      )}
      {chores.map((r) => {
        if (r.rule.kind !== 'after') return null;
        const slot = r.times[0];
        const doneToday = doneSet.has(occurrenceKey(r.id, slot));
        const due = dueDay(r.rule, r.last_done);
        const left = diffDays(today, due);
        const period = r.last_done ? Math.max(1, diffDays(r.last_done, due)) : 1;
        const elapsed = r.last_done ? diffDays(r.last_done, today) : period;
        const pct = doneToday ? 0 : Math.min(100, Math.round((elapsed / period) * 100));
        const status = doneToday
          ? { text: 'сделано сегодня', color: 'var(--accent-ink)' }
          : left < 0
            ? { text: `просрочено на ${plural(-left, 'день', 'дня', 'дней')}`, color: 'var(--danger)' }
            : left === 0
              ? { text: `сегодня, ${slot}`, color: 'var(--warm)' }
              : left === 1
                ? { text: `завтра, ${slot}`, color: 'var(--muted)' }
                : { text: `через ${plural(left, 'день', 'дня', 'дней')}`, color: 'var(--muted)' };
        return (
          <div key={r.id} className="rem-row" style={{ alignItems: 'center' }}>
            <span className="list-icon hide-phone">
              <Icon name="repeat" size={20} />
            </span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'baseline' }}>
                <span style={{ fontWeight: 600 }}>{r.title}</span>
                <span style={{ fontSize: 13, color: 'var(--muted)' }}>{describe(r.rule)}</span>
              </div>
              <div style={{ fontSize: 13, color: 'var(--muted)' }}>
                {r.last_done ? `Прошлый раз — ${whenLabel(r.last_done, today)}` : 'Ещё не отмечали'} ·{' '}
                <span style={{ color: status.color, fontWeight: 600 }}>{status.text}</span>
              </div>
              <div className={`bar${left <= 0 && !doneToday ? ' warm' : ''}`} style={{ height: 6 }} aria-hidden="true">
                <i style={{ width: `${pct}%` }} />
              </div>
            </div>
            <div className="rem-actions">
              <button className="btn btn-ghost" type="button" onClick={() => setDone(r, slot, !doneToday)}>
                <Icon name={doneToday ? 'reset' : 'check'} size={16} />
                {doneToday ? 'Отменить' : 'Сделано'}
              </button>
              {actions(r)}
            </div>
          </div>
        );
      })}
    </div>
  );

  // ---------------------------------------------------------------- все
  const all = data.reminders
    .map((r) => ({ r, next: nextOccurrence(r.rule, today, r.last_done) }))
    .sort((a, b) => (a.next ?? '9999').localeCompare(b.next ?? '9999') || a.r.times[0].localeCompare(b.r.times[0]));
  const allView =
    all.length === 0 ? (
      <div className="panel" style={{ padding: 24, color: 'var(--muted)' }}>
        Напоминаний пока нет.
      </div>
    ) : (
      <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        {all.map(({ r, next: nx }) => (
          <li key={r.id} className="rem-row" style={{ alignItems: 'center' }}>
            <span className="mono" style={{ width: 52, flex: 'none', color: 'var(--muted)', lineHeight: 1.4 }}>
              {r.times.map((t) => (
                <span key={t} style={{ display: 'block' }}>
                  {t}
                </span>
              ))}
            </span>
            <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontWeight: 600, overflowWrap: 'anywhere' }}>{r.title}</span>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 13, color: 'var(--muted)' }}>
                <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                  <Icon name="repeat" size={14} />
                  {cap(describe(r.rule))}
                </span>
                <span>· {nx ? `следующий раз ${whenLabel(nx, today)}` : 'больше не повторится'}</span>
                {checklistChip(r)}
              </div>
            </div>
            <div className="rem-actions">{actions(r)}</div>
          </li>
        ))}
      </ul>
    );

  // Редкие настройки: на телефоне — свёрнуты под «Ещё».
  const extras = (
    <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label className="label" htmlFor="r-list">
            Чек-лист
          </label>
          <select id="r-list" className="field" value={draft.checklist_id} onChange={(e) => setDraft({ ...draft, checklist_id: e.target.value })}>
            <option value="">Без чек-листа</option>
            {data.checklists.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label className="label" htmlFor="r-nag">
            Если не отметили «Сделано»
          </label>
          <select id="r-nag" className="field" value={draft.nag} onChange={(e) => setDraft({ ...draft, nag: Number(e.target.value) })}>
            <option value={0}>Не повторять</option>
            <option value={15}>Напомнить ещё раз через 15 минут</option>
            <option value={30}>Напомнить ещё раз через 30 минут</option>
            <option value={60}>Напомнить ещё раз через час</option>
          </select>
          {draft.nag > 0 && <span style={{ fontSize: 13, color: 'var(--muted)' }}>До трёх повторов — пока не нажмёте «Сделано» в уведомлении или здесь.</span>}
        </div>
    </>
  );

  const form = (
    <form ref={formRef} className={phone ? undefined : 'panel'} style={{ padding: phone ? 0 : 24, display: 'flex', flexDirection: 'column', gap: 14 }} onSubmit={submit}>
      {!phone && (
        <h2 className="display" style={{ margin: 0, fontSize: 20 }}>
          {draft.id ? 'Изменить напоминание' : 'Новое напоминание'}
        </h2>
      )}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        <label className="label" htmlFor="r-what">
          Что сделать
        </label>
        <input
          ref={titleRef}
          id="r-what"
          className="field"
          maxLength={120}
          placeholder="Например, взять пропуск"
          value={draft.title}
          onChange={(e) => setDraft({ ...draft, title: e.target.value })}
        />
      </div>
      <RuleEditor key={formKey} rule={draft.rule} times={draft.times} today={today} onChange={(rule, times) => setDraft({ ...draft, rule, times })} />
      {phone ? (
        <details className="more-opts">
          <summary>Ещё: чек-лист, повтор, если не отметили</summary>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 12 }}>{extras}</div>
        </details>
      ) : (
        extras
      )}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-primary" type="submit" disabled={saving || !draft.title.trim()} style={{ flex: 1 }}>
          <Icon name={draft.id ? 'check' : 'plus'} size={18} />
          {saving ? 'Сохраняем…' : draft.id ? 'Сохранить' : 'Добавить'}
        </button>
        {draft.id && (
          <button
            className="btn btn-ghost"
            type="button"
            onClick={() => {
              setDraft(emptyDraft(now));
              setFormKey((k) => k + 1);
            }}
          >
            Отмена
          </button>
        )}
      </div>
    </form>
  );

  const views: { id: View; label: string; count?: number }[] = [
    { id: 'today', label: 'Сегодня', count: todays.length - doneCount },
    { id: 'chores', label: 'Быт по кругу', count: chores.filter((r) => r.rule.kind === 'after' && today >= dueDay(r.rule, r.last_done) && !doneSet.has(occurrenceKey(r.id, r.times[0]))).length },
    { id: 'all', label: 'Все' },
  ];

  return (
    <div className="rem-layout">
      <section style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 16, flexWrap: 'wrap' }}>
          <div style={{ flex: '1 1 220px' }}>
            <h1 className="display" style={{ margin: 0, fontSize: 'clamp(28px, 4vw, 40px)', lineHeight: 1.1 }}>
              Напоминания
            </h1>
            <p style={{ margin: '6px 0 0', color: 'var(--muted)' }}>
              {phone ? (todays.length > 0 ? `Сделано ${doneCount} из ${todays.length}` : 'На сегодня ничего') : dayTitle(now)}
              {!phone && todays.length > 0 && ` · ${doneCount} из ${todays.length} сделано`}
            </p>
          </div>
          {todays.length > 0 && (
            <div className="bar warm hide-phone" style={{ flex: '0 1 220px' }} aria-hidden="true">
              <i style={{ width: `${(doneCount / todays.length) * 100}%` }} />
            </div>
          )}
        </div>

        <div className="tabs-row" role="group" aria-label="Что показать">
          {views.map((v) => (
            <button key={v.id} type="button" aria-pressed={view === v.id} onClick={() => setView(v.id)}>
              {v.label}
              {!!v.count && <span className="badge">{v.count}</span>}
            </button>
          ))}
        </div>

        {view === 'today' && <PushPanel toast={toast} />}
        {view === 'today' ? todayView : view === 'chores' ? choresView : allView}
      </section>

      <aside style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {!phone && form}

        <section className="hide-phone" style={{ padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <h2 className="group-title" style={{ padding: 0 }}>
            Завтра, {weekdayName(tomorrow)}
          </h2>
          {tomorrowList.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: 14 }}>Пока ничего.</p>
          ) : (
            tomorrowList.map((o) => (
              <div key={o.key} style={{ display: 'flex', gap: 12, color: 'var(--muted)' }}>
                <span className="mono" style={{ width: 52, flex: 'none' }}>
                  {o.slot}
                </span>
                <span style={{ minWidth: 0, overflowWrap: 'anywhere' }}>{o.reminder.title}</span>
              </div>
            ))
          )}
          {tomorrowList.length > 0 && (
            <p style={{ margin: 0, fontSize: 13, color: 'var(--muted)' }}>{plural(tomorrowList.length, 'дело', 'дела', 'дел')}</p>
          )}
        </section>
      </aside>

      {phone && <Fab label="Новое напоминание" onClick={() => openForm(emptyDraft(now))} />}
      {phone && sheet && (
        <Sheet
          title={draft.id ? 'Изменить напоминание' : 'Новое напоминание'}
          onClose={() => {
            setSheet(false);
            if (draft.id) setDraft(emptyDraft(now));
          }}
        >
          {form}
        </Sheet>
      )}

      {confirm && (
        <Confirm
          title={`Удалить «${confirm.title}»?`}
          text={confirm.rule.kind === 'once' ? 'Напоминание удалится.' : `Повтор «${describe(confirm.rule)}» удалится целиком, со всеми отметками.`}
          action="Удалить"
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            const r = confirm;
            setConfirm(null);
            mutate(
              (d) => ({
                ...d,
                reminders: d.reminders.filter((x) => x.id !== r.id),
                done: d.done.filter((x) => !x.startsWith(`${r.id}@`)),
                snoozed: d.snoozed.filter((s) => s.reminder_id !== r.id),
              }),
              () => api(`reminders/${r.id}`, 'DELETE'),
            );
          }}
        />
      )}
    </div>
  );
}
