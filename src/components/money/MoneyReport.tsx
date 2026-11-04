'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { formatMinor, money, parseAmount } from '@/lib/currencies';
import { localDay, plural } from '@/lib/dates';
import { periodRange, type Period, type PriceStat } from '@/lib/moneyReport';
import { Icon } from '../icons';
import { useMoney } from './MoneyShell';
import { ScopeSwitch, type Scope } from './MoneyParts';

interface Report {
  title: string;
  from: string;
  to: string;
  spend: number;
  income: number;
  prev_spend: number;
  prev_income: number;
  bars: { from: string; to: string; short: string; spend: number; income: number }[];
  /** Неделя по дням (Пн…Вс); у месяца и года — пусто. */
  days: { day: string; spend: number }[];
  categories: { id: string | null; name: string; spend: number; prev: number }[];
  payees: { name: string; spend: number; count: number }[];
  missing_rates: string[];
}

const PERIOD_LABEL: Record<Period, string> = { week: 'Неделя', month: 'Месяц', year: 'Год' };
const PREV_LABEL: Record<Period, string> = { week: 'к прошлой неделе', month: 'к прошлому месяцу', year: 'к прошлому году' };

const pct = (now: number, before: number) => (before > 0 ? Math.round(((now - before) / before) * 100) : null);
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}%`;

/**
 * Отчёты: траты за неделю, месяц или год в основной валюте — со сравнением
 * с прошлым периодом, столбиками за 6 периодов, категориями (чек — по
 * позициям) и местами; ниже — бюджеты, цены из чеков и вопрос ИИ.
 */
export default function MoneyReport() {
  const { data, shown, aiOn } = useMoney();
  const base = data.settings!.base_currency;
  const [period, setPeriod] = useState<Period>('month');
  const [day, setDay] = useState(localDay());
  const [scope, setScope] = useState<Scope>('all');
  const [rep, setRep] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [picked, setPicked] = useState<number | null>(null);
  const [byDay, setByDay] = useState(false);
  const [openCat, setOpenCat] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    setError(null);
    api<Report>(`money/report?period=${period}&day=${day}&scope=${scope}`)
      .then((r) => !stop && (setRep(r), setPicked(null)))
      .catch((e) => !stop && setError((e as Error).message));
    return () => {
      stop = true;
    };
  }, [period, day, scope, data]);

  const shift = (n: number) => setDay(periodRange(period, day, n).from);
  const isNow = rep ? localDay() >= rep.from && localDay() <= rep.to : true;
  const change = rep ? pct(rep.spend, rep.prev_spend) : null;
  const maxBar = rep ? Math.max(1, ...rep.bars.map((b) => b.spend)) : 1;
  const maxCat = rep?.categories[0]?.spend || 1;

  return (
    <>
      <header className="m-head">
        <h1 className="display m-h1" style={{ flex: 1 }}>
          Отчёты
        </h1>
      </header>
      <main className="m-main">
        <div className="seg" role="group" aria-label="Период" style={{ gridTemplateColumns: 'repeat(3, 1fr)' }}>
          {(['week', 'month', 'year'] as Period[]).map((p) => (
            <button key={p} type="button" aria-pressed={period === p} onClick={() => (setPeriod(p), setDay(localDay()))}>
              {PERIOD_LABEL[p]}
            </button>
          ))}
        </div>
        <ScopeSwitch scope={scope} onChange={setScope} />
        <div className="m-month">
          <button className="icon-btn bare" type="button" aria-label="Раньше" onClick={() => shift(-1)}>
            <Icon name="back" />
          </button>
          <b>{rep?.title ?? periodRange(period, day).title}</b>
          <button className="icon-btn bare m-flip" type="button" aria-label="Позже" disabled={isNow} onClick={() => shift(1)}>
            <Icon name="back" />
          </button>
        </div>
        {error && (
          <p className="m-error" role="alert">
            {error}
          </p>
        )}

        {!rep && !error && (
          // Место под отчёт, пока он считается, — чтобы карточки ниже не прыгали.
          <section className="m-card m-reading" role="status" aria-busy="true" style={{ minHeight: 300, justifyContent: 'center' }}>
            <span className="m-spinner" aria-hidden="true" />
            <span className="muted">Считаю…</span>
          </section>
        )}
        {rep && (
          <>
            <section className="m-card" style={{ gap: 4 }}>
              <div className="muted m-small">Потрачено</div>
              <div className="display m-total">{money(rep.spend, base, { whole: true })}</div>
              <div className="muted m-small">
                {change !== null && change !== 0 && (
                  <>
                    <span className={change > 0 ? 'm-up' : 'm-down'}>{signed(change)}</span> {PREV_LABEL[period]} ·{' '}
                  </>
                )}
                доходы <span className="mono">{money(rep.income, base, { whole: true })}</span>
                {rep.income > 0 && (
                  <>
                    {' '}
                    · осталось <span className="mono">{money(rep.income - rep.spend, base, { whole: true, sign: true })}</span>
                  </>
                )}
              </div>
              {period === 'week' && rep.days.length > 0 && (
                <div className="seg m-seg-small" role="group" aria-label="Как показать неделю" style={{ gridTemplateColumns: '1fr 1fr', marginTop: 8 }}>
                  <button type="button" aria-pressed={!byDay} onClick={() => setByDay(false)}>
                    По неделям
                  </button>
                  <button type="button" aria-pressed={byDay} onClick={() => setByDay(true)}>
                    По дням
                  </button>
                </div>
              )}
              {period === 'week' && byDay && rep.days.length > 0 ? (
                <DayBars days={rep.days} base={base} />
              ) : (
              <div className="m-bars" role="group" aria-label="Траты по периодам">
                {rep.bars.map((b, i) => {
                  const last = i === rep.bars.length - 1;
                  const on = picked === i || (picked === null && last);
                  return (
                    <button
                      key={b.from}
                      type="button"
                      className={`m-barcol${last ? ' now' : ''}${on ? ' on' : ''}`}
                      aria-pressed={on}
                      aria-label={`${b.short}: ${money(b.spend, base, { trim: true })}${on ? '. Нажмите ещё раз — траты по дням' : ''}`}
                      title={`${b.short}: ${money(b.spend, base, { trim: true })}${on ? ' · ещё раз — по дням' : ''}`}
                      onClick={() => (picked === i ? setDay(b.from) : setPicked(i))}
                    >
                      <span className="m-barval mono">{on ? formatMinor(b.spend, base, { whole: true }) : ''}</span>
                      <span className="m-barwrap">
                        <i style={{ height: `${b.spend ? Math.max(3, Math.round((b.spend / maxBar) * 100)) : 0}%` }} />
                      </span>
                      <span className="m-barlbl">{b.short}</span>
                    </button>
                  );
                })}
              </div>
              )}
              {!(period === 'week' && byDay) && (() => {
                // Подпись под столбиками: какой период выбран, с полными датами.
                const sel = picked ?? rep.bars.length - 1;
                const bar = rep.bars[sel];
                return (
                  <p className="muted m-small" style={{ margin: 0 }} aria-live="polite">
                    <b>{periodRange(period, bar.from).title}</b>
                    {' · '}
                    {money(bar.spend, base, { trim: true })}
                    {sel === picked && picked !== rep.bars.length - 1 && (
                      <>
                        {' · '}
                        <button className="m-link-btn" type="button" onClick={() => setDay(bar.from)}>
                          открыть этот период
                        </button>
                      </>
                    )}
                  </p>
                );
              })()}
              {rep.missing_rates.length > 0 && (
                <p className="m-small" style={{ margin: 0, color: 'var(--warm)' }}>
                  Без операций в {rep.missing_rates.join(', ')}: нет курса (Настройки → Валюты).
                </p>
              )}
            </section>

            <section className="m-card">
              <h2 className="m-card-title">По категориям</h2>
              {rep.categories.filter((c) => c.spend > 0).length === 0 && <p className="muted" style={{ margin: 0 }}>За этот период трат нет.</p>}
              {rep.categories
                .filter((c) => c.spend > 0)
                .map((c) => {
                  const d = pct(c.spend, c.prev);
                  const key = c.id ?? 'none';
                  const isOpen = openCat === key;
                  return (
                    <div key={key} className="m-catbar">
                      <button type="button" className="m-catbar-btn" aria-expanded={isOpen} onClick={() => setOpenCat(isOpen ? null : key)}>
                        <span className="m-row-between">
                          <span>
                            {c.name}
                            {d !== null && Math.abs(d) >= 10 && <small className={`m-delta ${d > 0 ? 'm-up' : 'm-down'}`}>{signed(d)}</small>}
                          </span>
                          <span className="mono">{money(c.spend, base, { trim: true })}</span>
                        </span>
                        <span className="bar">
                          <i style={{ width: `${Math.max(2, Math.round((c.spend / maxCat) * 100))}%` }} />
                        </span>
                      </button>
                      {isOpen && <CategoryDetail cat={key} name={c.name} period={period} day={day} from={rep.from} scope={scope} base={base} />}
                    </div>
                  );
                })}
            </section>

            {rep.payees.length > 0 && (
              <section className="m-card" style={{ gap: 0 }}>
                <h2 className="m-card-title" style={{ marginBottom: 6 }}>
                  Где больше всего
                </h2>
                {rep.payees.slice(0, 5).map((p) => (
                  <div key={p.name} className="m-kv m-kv-row">
                    <span>
                      {p.name} <span className="muted m-small">· {plural(p.count, 'раз', 'раза', 'раз')}</span>
                    </span>
                    <span className="mono">{money(p.spend, base, { trim: true })}</span>
                  </div>
                ))}
              </section>
            )}
          </>
        )}

        {shown('budgets') && <Budgets />}
        {shown('prices') && <Prices />}
        {aiOn() && <Ask />}
      </main>
    </>
  );
}

const WD = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

/** Неделя по дням: семь столбиков с суммой над каждым непустым. */
function DayBars({ days, base }: { days: { day: string; spend: number }[]; base: string }) {
  const max = Math.max(1, ...days.map((x) => x.spend));
  const today = localDay();
  return (
    <div className="m-bars m-bars-days" role="list" aria-label="Траты по дням недели">
      {days.map((x, i) => (
        <div key={x.day} role="listitem" className={`m-barcol${x.day === today ? ' now on' : ''}`} aria-label={`${WD[i]}, ${new Date(`${x.day}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}: ${money(x.spend, base, { trim: true })}`}>
          <span className="m-barval mono">{x.spend ? formatMinor(x.spend, base, { whole: true }) : ''}</span>
          <span className="m-barwrap">
            <i style={{ height: `${x.spend ? Math.max(3, Math.round((x.spend / max) * 100)) : 0}%` }} />
          </span>
          <span className="m-barlbl">
            {WD[i]}
            <small>{Number(x.day.slice(8))}</small>
          </span>
        </div>
      ))}
    </div>
  );
}

interface CatReport {
  ops: { id: string; day: string; payee: string | null; base_minor: number }[];
  trend: { from: string; short: string; spend: number }[];
}

/** Раскрытая категория: 6 месяцев столбиками и её траты за период. */
function CategoryDetail({ cat, name, period, day, from, scope, base }: { cat: string; name: string; period: Period; day: string; from: string; scope: Scope; base: string }) {
  const [r, setR] = useState<CatReport | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    setR(null);
    api<CatReport>(`money/report/category?cat=${encodeURIComponent(cat)}&period=${period}&day=${day}&scope=${scope}`)
      .then(setR)
      .catch((e) => setError((e as Error).message));
  }, [cat, period, day, scope]);
  if (error) return <p className="m-error">{error}</p>;
  if (!r) return <span className="muted m-small">Считаю…</span>;
  const max = Math.max(1, ...r.trend.map((t) => t.spend));
  const avg = r.trend.slice(0, 5).reduce((s, t) => s + t.spend, 0) / 5;
  const last = r.trend[r.trend.length - 1];
  return (
    <div className="m-catdetail">
      <div className="m-bars m-bars-mini" role="list" aria-label={`«${name}» за 6 месяцев`}>
        {r.trend.map((t, i) => (
          <div key={t.from} role="listitem" className={`m-barcol${i === r.trend.length - 1 ? ' now on' : ''}`} aria-label={`${t.short}: ${money(t.spend, base, { trim: true })}`}>
            <span className="m-barwrap">
              <i style={{ height: `${t.spend ? Math.max(3, Math.round((t.spend / max) * 100)) : 0}%` }} />
            </span>
            <span className="m-barlbl">{t.short}</span>
          </div>
        ))}
      </div>
      {avg > 0 && (
        <small className="muted">
          В среднем {money(Math.round(avg), base, { whole: true })} в месяц, в {last.short.toLowerCase()} — {money(last.spend, base, { whole: true })}
        </small>
      )}
      {r.ops.slice(0, 8).map((o) => (
        <div key={o.id} className="m-kv">
          <span>
            <span className="muted m-small">{new Date(`${o.day}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })}</span> {o.payee || 'Без названия'}
          </span>
          <span className="mono">{money(o.base_minor, base, { trim: true })}</span>
        </div>
      ))}
      {!r.ops.length && <small className="muted">За этот период трат нет.</small>}
      {period !== 'year' && r.ops.length > 0 && (
        <Link className="m-card-link" href={`/money/ops?cat=${encodeURIComponent(cat)}&month=${from.slice(0, 7)}`}>
          {r.ops.length > 8 ? `Все ${r.ops.length} в «Операциях»` : 'Открыть в «Операциях»'}
        </Link>
      )}
    </div>
  );
}

/** Бюджеты на текущий месяц: сколько потрачено из лимита; лимиты правятся здесь же. */
function Budgets() {
  const { data, reload, toast } = useMoney();
  const base = data.settings!.base_currency;
  const [edit, setEdit] = useState(false);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const cats = data.categories.filter((c) => c.kind === 'expense');
  const spent = new Map<string | null, number>();
  for (const p of data.month_parts) spent.set(p.category_id, (spent.get(p.category_id) ?? 0) + p.base_minor);
  const limits = new Map(data.budgets.map((b) => [b.category_id, b.limit_minor]));

  async function save() {
    try {
      for (const c of cats) {
        const raw = drafts[c.id];
        if (raw === undefined) continue;
        const n = raw.trim() ? parseAmount(raw, base) : null;
        if (raw.trim() && !n) throw new Error(`«${c.name}»: введите сумму, например 12000.`);
        if ((n ?? null) !== (limits.get(c.id) ?? null)) await api('money/budgets', 'PUT', { category_id: c.id, limit_minor: n });
      }
      await reload();
      setEdit(false);
      setDrafts({});
      toast('Бюджеты сохранены');
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <section className="m-card" id="budgets">
      <div className="m-card-head">
        <h2 className="m-card-title">Бюджеты на месяц</h2>
        {!edit && (
          <button className="m-card-link m-link-btn" type="button" onClick={() => setEdit(true)}>
            {data.budgets.length ? 'Изменить' : 'Задать'}
          </button>
        )}
      </div>
      {!edit && !data.budgets.length && <p className="muted" style={{ margin: 0 }}>Задайте лимит на кафе или развлечения — на главной будет видно, сколько осталось.</p>}
      {!edit &&
        data.budgets.map((b) => {
          const s = spent.get(b.category_id) ?? 0;
          const share = s / b.limit_minor;
          return (
            <div key={b.category_id} className="m-catbar">
              <div className="m-row-between">
                <span>{cats.find((c) => c.id === b.category_id)?.name}</span>
                <span className="mono">
                  {money(s, base, { trim: true })} <span className="muted">/ {money(b.limit_minor, base, { trim: true })}</span>
                </span>
              </div>
              <div className={`bar${share >= 0.9 ? ' warm' : ''}`}>
                <i style={{ width: `${Math.min(100, Math.max(2, Math.round(share * 100)))}%` }} />
              </div>
              <small className="muted">{share >= 1 ? `сверх на ${money(s - b.limit_minor, base, { trim: true })}` : `осталось ${money(b.limit_minor - s, base, { trim: true })}`}</small>
            </div>
          );
        })}
      {edit && (
        <>
          <p className="muted m-small" style={{ margin: 0 }}>
            Лимит в месяц, {base}. Пусто — без бюджета.
          </p>
          {cats.map((c) => (
            <label key={c.id} className="m-row-between m-budget-row">
              <span>{c.name}</span>
              <input
                className="field mono"
                inputMode="decimal"
                placeholder="—"
                aria-label={`Бюджет: ${c.name}`}
                value={drafts[c.id] ?? (limits.has(c.id) ? formatMinor(limits.get(c.id)!, base, { trim: true }).replace(/\s/g, '') : '')}
                onChange={(e) => setDrafts((d) => ({ ...d, [c.id]: e.target.value }))}
              />
            </label>
          ))}
          <div className="m-row">
            <button className="btn btn-ghost" type="button" onClick={() => (setEdit(false), setDrafts({}))}>
              Отмена
            </button>
            <button className="btn btn-primary" type="button" style={{ flex: 1 }} onClick={save}>
              Сохранить
            </button>
          </div>
        </>
      )}
    </section>
  );
}

/** Цены товаров из чеков: что подорожало; поиск и история одного товара. */
function Prices() {
  const [items, setItems] = useState<PriceStat[] | null>(null);
  const [q, setQ] = useState('');
  const [all, setAll] = useState(false);
  const [open, setOpen] = useState<PriceStat | null>(null);
  const [history, setHistory] = useState<{ day: string; payee: string | null; unit_price: number; name: string }[]>([]);

  useEffect(() => {
    const t = setTimeout(() => {
      api<{ items: PriceStat[] }>(`money/prices?q=${encodeURIComponent(q)}`)
        .then((r) => setItems(r.items))
        .catch(() => setItems([]));
    }, q ? 300 : 0);
    return () => clearTimeout(t);
  }, [q]);

  useEffect(() => {
    if (!open) return;
    api<{ history: typeof history }>(`money/prices?key=${encodeURIComponent(open.key)}`).then((r) => setHistory(r.history));
  }, [open]);

  if (items === null || (!items.length && !q)) return null;
  const list = all || q ? items : items.filter((p) => p.change !== null).slice(0, 5);
  const per = (p: PriceStat) => (p.unit ? ` за ${p.unit}` : '');

  return (
    <section className="m-card">
      <div className="m-card-head">
        <h2 className="m-card-title">Цены по чекам</h2>
        <button className="m-card-link m-link-btn" type="button" onClick={() => setAll(!all)}>
          {all ? 'Свернуть' : 'Все товары'}
        </button>
      </div>
      {(all || q) && <input className="field" type="search" placeholder="Молоко, бананы…" aria-label="Найти товар" value={q} onChange={(e) => setQ(e.target.value)} />}
      {!list.length && <p className="muted" style={{ margin: 0 }}>{q ? 'Ничего не нашлось.' : 'Цены появятся, когда один товар попадёт хотя бы в два чека.'}</p>}
      {list.map((p) => (
        <div key={p.key}>
          <button type="button" className="m-price" aria-expanded={open?.key === p.key} onClick={() => setOpen(open?.key === p.key ? null : p)}>
            <span className="m-op-t">
              <b>
                {p.name}
                {per(p)}
              </b>
              <small>
                {plural(p.count, 'покупка', 'покупки', 'покупок')}
                {p.last.payee ? ` · ${p.last.payee}` : ''}
              </small>
            </span>
            <span className="m-op-r">
              <span className="mono">
                {p.change !== null && <span className="muted">{formatMinor(p.first.price, p.currency)} → </span>}
                {formatMinor(p.last.price, p.currency)}
              </span>
              {p.change !== null && p.change !== 0 && <small className={`mono ${p.change > 0 ? 'm-up' : 'm-down'}`}>{signed(p.change)}</small>}
            </span>
          </button>
          {open?.key === p.key && (
            <div className="m-kv-box" style={{ marginBottom: 8 }}>
              {history.map((h, i) => (
                <div key={i} className="m-kv">
                  <span className="muted">
                    {new Date(`${h.day}T12:00:00`).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: '2-digit' })}
                    {h.payee ? ` · ${h.payee}` : ''}
                  </span>
                  <span className="mono">{money(h.unit_price, p.currency)}</span>
                </div>
              ))}
              {p.min < p.last.price && (
                <div className="m-kv">
                  <span className="muted">Дешевле всего было</span>
                  <span className="mono">{money(p.min, p.currency)}</span>
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </section>
  );
}

const EXAMPLES = ['Сколько ушло на кафе за 3 месяца?', 'Где я трачу больше всего?', 'Что подорожало?', 'В каком месяце я потратил больше всего?'];

/** Вопрос ИИ о своих деньгах — по данным за год. */
export function Ask() {
  const [q, setQ] = useState('');
  const [answer, setAnswer] = useState<{ q: string; a: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(question: string) {
    const t = question.trim();
    if (!t) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ answer: string }>('money/ask', 'POST', { question: t, today: localDay() });
      setAnswer({ q: t, a: r.answer });
      setQ('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="m-card">
      <h2 className="m-card-title">Спросить о своих тратах</h2>
      {answer && (
        <div className="m-answer" aria-live="polite">
          <small className="muted">{answer.q}</small>
          <p>{answer.a}</p>
        </div>
      )}
      <form
        className="m-row"
        onSubmit={(e) => {
          e.preventDefault();
          send(q);
        }}
      >
        <input className="field" placeholder="Сколько ушло на такси в сентябре?" aria-label="Вопрос" value={q} maxLength={500} disabled={busy} onChange={(e) => setQ(e.target.value)} style={{ flex: 1 }} />
        <button className="btn btn-primary" type="submit" disabled={busy || !q.trim()}>
          {busy ? <span className="m-spinner m-spinner-light" aria-hidden="true" /> : 'Спросить'}
        </button>
      </form>
      {!answer && !busy && (
        <div className="m-chips">
          {EXAMPLES.map((x) => (
            <button key={x} type="button" className="chip" onClick={() => send(x)}>
              {x}
            </button>
          ))}
        </div>
      )}
      {error && (
        <p className="m-error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
