'use client';

import { useState } from 'react';
import { describe, weekday, WEEKDAY_SHORT, type AfterUnit, type End, type Rule, type Unit } from '@/lib/recur';
import { Icon } from './icons';

type Preset = 'once' | 'daily' | 'weekdays' | 'weekly' | 'monthly' | 'after' | 'custom';

const PRESETS: { id: Preset; label: string }[] = [
  { id: 'once', label: 'Один раз' },
  { id: 'daily', label: 'Каждый день' },
  { id: 'weekdays', label: 'По будням' },
  { id: 'weekly', label: 'Каждую неделю' },
  { id: 'monthly', label: 'Каждый месяц' },
  { id: 'after', label: 'После выполнения' },
  { id: 'custom', label: 'Настроить…' },
];

/** Пн … Вс — в таком порядке показываем дни недели. */
const WEEK = [1, 2, 3, 4, 5, 6, 0];

function detect(rule: Rule): Preset {
  if (rule.kind === 'once') return 'once';
  if (rule.kind === 'after') return 'after';
  if (rule.end && rule.end.type !== 'never') return 'custom';
  if (rule.every !== 1) return 'custom';
  if (rule.unit === 'day') return 'daily';
  if (rule.unit === 'week') {
    const key = (rule.weekdays ?? []).join(',');
    if (key === '1,2,3,4,5') return 'weekdays';
    if ((rule.weekdays ?? []).length <= 1) return 'weekly';
    return 'custom';
  }
  if (rule.unit === 'month' && (!rule.monthly || rule.monthly.type === 'day')) return 'monthly';
  return 'custom';
}

function fromPreset(p: Preset, today: string, prev: Rule): Rule {
  const start = prev.kind === 'once' ? (prev.date >= today ? prev.date : today) : prev.start;
  switch (p) {
    case 'once':
      return { kind: 'once', date: start };
    case 'daily':
      return { kind: 'repeat', unit: 'day', every: 1, start };
    case 'weekdays':
      return { kind: 'repeat', unit: 'week', every: 1, start, weekdays: [1, 2, 3, 4, 5] };
    case 'weekly':
      return { kind: 'repeat', unit: 'week', every: 1, start, weekdays: [weekday(start)] };
    case 'monthly':
      return { kind: 'repeat', unit: 'month', every: 1, start, monthly: { type: 'day', day: Number(start.slice(8)) } };
    case 'after':
      return { kind: 'after', unit: 'day', every: 7, start };
    case 'custom':
      // Из «после выполнения» — тот же шаг, но уже по календарю.
      if (prev.kind === 'repeat') return prev;
      return prev.kind === 'after' ? { kind: 'repeat', unit: prev.unit, every: prev.every, start } : { kind: 'repeat', unit: 'day', every: 2, start };
  }
}

/** Название шага в нужной форме: «2 дня», «5 дней», «1 месяц». */
const UNIT_FORMS: Record<Unit, [string, string, string]> = {
  day: ['день', 'дня', 'дней'],
  week: ['неделю', 'недели', 'недель'],
  month: ['месяц', 'месяца', 'месяцев'],
  year: ['год', 'года', 'лет'],
};
function unitWord(n: number, unit: Unit): string {
  const [one, few, many] = UNIT_FORMS[unit];
  const a = n % 10;
  const b = n % 100;
  if (a === 1 && b !== 11) return one;
  if (a >= 2 && a <= 4 && (b < 12 || b > 14)) return few;
  return many;
}
const NTH = [
  { v: 1, label: '1-й' },
  { v: 2, label: '2-й' },
  { v: 3, label: '3-й' },
  { v: 4, label: '4-й' },
  { v: -1, label: 'последний' },
];
const WEEKDAY_FULL = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

const row: React.CSSProperties = { display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' };
const num: React.CSSProperties = { width: 72, textAlign: 'center' };

interface Props {
  rule: Rule;
  times: string[];
  today: string;
  onChange: (rule: Rule, times: string[]) => void;
}

/**
 * Повтор и время напоминания. Сверху — частые варианты одним нажатием,
 * «Настроить…» открывает всё (src/lib/recur.ts): каждые N дней/недель/
 * месяцев/лет, дни недели, «вторая суббота», конец повтора. Внизу —
 * подпись словами, чтобы было видно, что получилось.
 */
export default function RuleEditor({ rule, times, today, onChange }: Props) {
  const [custom, setCustom] = useState(() => detect(rule) === 'custom');
  const preset = custom ? 'custom' : detect(rule);
  const set = (r: Rule) => onChange(r, r.kind === 'after' ? times.slice(0, 1) : times);

  const pick = (p: Preset) => {
    setCustom(p === 'custom');
    set(fromPreset(p, today, rule));
  };

  const setTime = (i: number, v: string) => onChange(rule, times.map((t, j) => (j === i ? v : t)));
  const addTime = () => {
    const last = times[times.length - 1] ?? '09:00';
    const h = Math.min(23, Number(last.slice(0, 2)) + 3);
    onChange(rule, [...times, `${String(h).padStart(2, '0')}:${last.slice(3, 5)}`]);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
        <legend className="label" style={{ padding: 0, marginBottom: 8 }}>
          Повторять
        </legend>
        <div style={row}>
          {PRESETS.map((p) => (
            <button key={p.id} type="button" className="chip" aria-pressed={preset === p.id} onClick={() => pick(p.id)}>
              {p.label}
            </button>
          ))}
        </div>
      </fieldset>

      {rule.kind === 'once' && (
        <Field label="День" id="rule-date">
          <input id="rule-date" className="field" type="date" min={today} value={rule.date} onChange={(e) => e.target.value && set({ ...rule, date: e.target.value })} />
        </Field>
      )}

      {rule.kind === 'after' && (
        <>
          <div style={row}>
            <span>Через</span>
            <label className="sr-only" htmlFor="after-n">
              Сколько
            </label>
            <input id="after-n" className="field mono" style={num} type="number" min={1} max={365} value={rule.every} onChange={(e) => set({ ...rule, every: clamp(e.target.value, 1, 365) })} />
            <label className="sr-only" htmlFor="after-unit">
              Чего
            </label>
            <select id="after-unit" className="field" style={{ width: 'auto' }} value={rule.unit} onChange={(e) => set({ ...rule, unit: e.target.value as AfterUnit })}>
              {(['day', 'week', 'month'] as AfterUnit[]).map((u) => (
                <option key={u} value={u}>
                  {unitWord(rule.every, u)}
                </option>
              ))}
            </select>
            <span>после того, как отметили</span>
          </div>
          <Field label="Первый раз" id="after-start">
            <input id="after-start" className="field" type="date" value={rule.start} onChange={(e) => e.target.value && set({ ...rule, start: e.target.value })} />
          </Field>
        </>
      )}

      {rule.kind === 'repeat' && custom && <Advanced rule={rule} set={set} />}

      <Field label={times.length > 1 ? 'Время' : 'Во сколько'} id="rule-time-0">
        <div style={row}>
          {times.map((t, i) => (
            <span key={i} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
              {i > 0 && (
                <label className="sr-only" htmlFor={`rule-time-${i}`}>
                  Время {i + 1}
                </label>
              )}
              <input id={`rule-time-${i}`} className="field mono" style={{ width: 120 }} type="time" required value={t} onChange={(e) => setTime(i, e.target.value)} />
              {times.length > 1 && (
                <button className="icon-btn bare" type="button" aria-label={`Убрать ${t}`} onClick={() => onChange(rule, times.filter((_, j) => j !== i))}>
                  <Icon name="x" size={16} />
                </button>
              )}
            </span>
          ))}
          {rule.kind !== 'after' && times.length < 8 && (
            <button className="btn btn-ghost" type="button" onClick={addTime} style={{ minHeight: 44 }}>
              <Icon name="plus" size={16} />
              Ещё время
            </button>
          )}
        </div>
      </Field>

      <p style={{ margin: 0, fontSize: 'calc(14px * var(--fs))', color: 'var(--muted)', display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <Icon name="repeat" size={16} />
        <span>
          {cap(describe(rule))}
          {times.length > 0 && `, в ${[...times].sort().join(', ')}`}
        </span>
      </p>
    </div>
  );
}

function Advanced({ rule, set }: { rule: Extract<Rule, { kind: 'repeat' }>; set: (r: Rule) => void }) {
  const end: End = rule.end ?? { type: 'never' };
  const mo = rule.monthly ?? { type: 'day' as const, day: Number(rule.start.slice(8)) };
  const days = rule.weekdays?.length ? rule.weekdays : [weekday(rule.start)];

  const changeUnit = (unit: Unit) => {
    const next: Rule = { kind: 'repeat', unit, every: rule.every, start: rule.start, end: rule.end };
    if (unit === 'week') next.weekdays = [weekday(rule.start)];
    if (unit === 'month') next.monthly = { type: 'day', day: Number(rule.start.slice(8)) };
    set(next);
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 14, borderRadius: 14, border: '1px solid var(--line)', background: 'var(--soft)' }}>
      <div style={row}>
        <span>Каждые</span>
        <label className="sr-only" htmlFor="rep-n">
          Сколько
        </label>
        <input id="rep-n" className="field mono" style={num} type="number" min={1} max={365} value={rule.every} onChange={(e) => set({ ...rule, every: clamp(e.target.value, 1, 365) })} />
        <label className="sr-only" htmlFor="rep-unit">
          Чего
        </label>
        <select id="rep-unit" className="field" style={{ width: 'auto' }} value={rule.unit} onChange={(e) => changeUnit(e.target.value as Unit)}>
          {(Object.keys(UNIT_FORMS) as Unit[]).map((u) => (
            <option key={u} value={u}>
              {unitWord(rule.every, u)}
            </option>
          ))}
        </select>
      </div>

      {rule.unit === 'week' && (
        <div role="group" aria-label="Дни недели" style={row}>
          {WEEK.map((w) => {
            const on = days.includes(w);
            return (
              <button
                key={w}
                type="button"
                className="chip"
                aria-pressed={on}
                aria-label={WEEKDAY_FULL[w]}
                style={{ minWidth: 44, minHeight: 36, justifyContent: 'center' }}
                onClick={() => {
                  const next = on ? days.filter((x) => x !== w) : [...days, w];
                  if (next.length) set({ ...rule, weekdays: next.sort((a, b) => a - b) });
                }}
              >
                {WEEKDAY_SHORT[w]}
              </button>
            );
          })}
        </div>
      )}

      {rule.unit === 'month' && (
        <fieldset style={{ border: 0, margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <legend className="sr-only">Какой день месяца</legend>
          <label style={row}>
            <input type="radio" name="mo" aria-label="По числу месяца" checked={mo.type === 'day' && mo.day !== -1} onChange={() => set({ ...rule, monthly: { type: 'day', day: Number(rule.start.slice(8)) } })} />
            <input
              className="field mono"
              style={num}
              type="number"
              min={1}
              max={31}
              aria-label="Число месяца"
              value={mo.type === 'day' && mo.day !== -1 ? mo.day : Number(rule.start.slice(8))}
              onChange={(e) => set({ ...rule, monthly: { type: 'day', day: clamp(e.target.value, 1, 31) } })}
            />
            <span>-го числа</span>
          </label>
          <label style={row}>
            <input type="radio" name="mo" aria-label="В последний день месяца" checked={mo.type === 'day' && mo.day === -1} onChange={() => set({ ...rule, monthly: { type: 'day', day: -1 } })} />
            <span>в последний день месяца</span>
          </label>
          <label style={row}>
            <input
              type="radio"
              name="mo"
              aria-label="По дню недели"
              checked={mo.type === 'nth'}
              onChange={() => set({ ...rule, monthly: { type: 'nth', nth: Math.min(4, Math.ceil(Number(rule.start.slice(8)) / 7)), weekday: weekday(rule.start) } })}
            />
            <span>в</span>
            <select
              className="field"
              style={{ width: 'auto' }}
              aria-label="Какой по счёту"
              value={mo.type === 'nth' ? mo.nth : 1}
              onChange={(e) => set({ ...rule, monthly: { type: 'nth', nth: Number(e.target.value), weekday: mo.type === 'nth' ? mo.weekday : weekday(rule.start) } })}
            >
              {NTH.map((n) => (
                <option key={n.v} value={n.v}>
                  {n.label}
                </option>
              ))}
            </select>
            <select
              className="field"
              style={{ width: 'auto' }}
              aria-label="День недели"
              value={mo.type === 'nth' ? mo.weekday : weekday(rule.start)}
              onChange={(e) => set({ ...rule, monthly: { type: 'nth', nth: mo.type === 'nth' ? mo.nth : 1, weekday: Number(e.target.value) } })}
            >
              {WEEK.map((w) => (
                <option key={w} value={w}>
                  {WEEKDAY_FULL[w]}
                </option>
              ))}
            </select>
          </label>
        </fieldset>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(150px, 100%), 1fr))', gap: 10 }}>
        <Field label="Начиная с" id="rep-start">
          <input id="rep-start" className="field" type="date" value={rule.start} onChange={(e) => e.target.value && set({ ...rule, start: e.target.value })} />
        </Field>
        <Field label="Закончить" id="rep-end">
          <select
            id="rep-end"
            className="field"
            value={end.type}
            onChange={(e) => {
              const t = e.target.value as End['type'];
              set({ ...rule, end: t === 'until' ? { type: 'until', date: rule.start } : t === 'count' ? { type: 'count', count: 10 } : undefined });
            }}
          >
            <option value="never">никогда</option>
            <option value="until">в дату</option>
            <option value="count">после N раз</option>
          </select>
        </Field>
        {end.type === 'until' && (
          <Field label="Последний день" id="rep-until">
            <input id="rep-until" className="field" type="date" min={rule.start} value={end.date} onChange={(e) => e.target.value && set({ ...rule, end: { type: 'until', date: e.target.value } })} />
          </Field>
        )}
        {end.type === 'count' && (
          <Field label="Сколько раз" id="rep-count">
            <input id="rep-count" className="field mono" type="number" min={1} max={1000} value={end.count} onChange={(e) => set({ ...rule, end: { type: 'count', count: clamp(e.target.value, 1, 1000) } })} />
          </Field>
        )}
      </div>
    </div>
  );
}

function Field({ label, id, children }: { label: string; id: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <label className="label" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

function clamp(v: string, min: number, max: number): number {
  const n = Math.round(Number(v));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : min;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
