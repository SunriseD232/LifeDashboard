'use client';

import Link from 'next/link';
import { useState } from 'react';
import { api } from '@/lib/api';
import { plural } from '@/lib/dates';
import { CURRENCIES, currency } from '@/lib/currencies';
import { MODULES, type MoneyCategory } from '@/lib/money';
import { Icon } from '../icons';
import { useMoney } from './MoneyShell';

/** «Ещё»: что показывать, валюты и курсы, категории. */
export default function MoneySettings() {
  const { data, reload, toast } = useMoney();
  const s = data.settings!;
  const [adding, setAdding] = useState('');

  async function patch(body: Record<string, unknown>, done?: string) {
    try {
      await api('money/settings', 'PATCH', body);
      await reload();
      if (done) toast(done);
    } catch (e) {
      toast((e as Error).message);
    }
  }

  const toggle = (id: string, on: boolean) => patch({ hidden: on ? s.hidden.filter((h) => h !== id) : [...s.hidden, id] });
  const all = [s.base_currency, ...s.currencies];
  const noCbr = all.filter((c) => c !== 'RUB' && !data.rates[c]);

  return (
    <>
      <header className="m-head">
        <h1 className="display m-h1" style={{ flex: 1 }}>
          Ещё
        </h1>
      </header>
      <main className="m-main">
        <Hub />
        <h2 className="group-title">Что показывать</h2>
        <div className="m-card" style={{ gap: 0, padding: '0 14px' }}>
          {MODULES.filter((m) => (m.id === 'family' ? data.family : ['ai', 'voice', 'receipts'].includes(m.id) ? data.ai : true)).map((m) => (
            <label key={m.id} className="m-set">
              <span className="m-op-t">
                <b>{m.label}</b>
                {m.hint && <small>{m.hint}</small>}
              </span>
              <input className="m-switch" type="checkbox" role="switch" checked={!s.hidden.includes(m.id)} onChange={(e) => toggle(m.id, e.target.checked)} />
            </label>
          ))}
        </div>
        <p className="muted m-small" style={{ margin: 0 }}>
          Выключенное пропадает из меню и форм. Данные остаются — включите, и всё вернётся.
        </p>

        <h2 className="group-title">Валюты</h2>
        <div className="m-card" style={{ gap: 12 }}>
          <label className="m-field">
            <span className="label">Основная — в ней итоги</span>
            <select className="field" value={s.base_currency} onChange={(e) => patch({ base_currency: e.target.value, currencies: all.filter((c) => c !== e.target.value) }, 'Основная валюта изменена')}>
              {CURRENCIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.code} — {c.name}
                </option>
              ))}
            </select>
          </label>
          <div className="m-field">
            <span className="label">Мои валюты</span>
            <div className="m-chips">
              {s.currencies.map((c) => (
                <span key={c} className="chip">
                  {c}
                  <button className="chip-x" type="button" aria-label={`Убрать ${c}`} onClick={() => patch({ currencies: s.currencies.filter((x) => x !== c) })}>
                    <Icon name="x" size={14} />
                  </button>
                </span>
              ))}
            </div>
            <div className="m-row">
              <select className="field" aria-label="Добавить валюту" value={adding} onChange={(e) => setAdding(e.target.value)}>
                <option value="">Добавить валюту…</option>
                {CURRENCIES.filter((c) => !all.includes(c.code)).map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code} — {c.name}
                  </option>
                ))}
              </select>
              <button
                className="btn btn-ghost"
                type="button"
                disabled={!adding}
                onClick={() => {
                  patch({ currencies: [...s.currencies, adding] });
                  setAdding('');
                }}
              >
                Добавить
              </button>
            </div>
          </div>
          <p className="muted m-small" style={{ margin: 0 }}>
            {data.rates_day ? `Курсы ЦБ на ${new Date(data.rates_day).toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}.` : 'Курсы ЦБ ещё не загрузились.'}
          </p>
          {noCbr.map((c) => (
            <UserRate key={c} code={c} />
          ))}
        </div>

        <h2 className="group-title">Категории расходов</h2>
        <Categories kind="expense" list={data.categories.filter((c) => c.kind === 'expense')} />
        <h2 className="group-title">Категории доходов</h2>
        <Categories kind="income" list={data.categories.filter((c) => c.kind === 'income')} />

        <div className="m-card" style={{ gap: 8 }}>
          {data.login && <span className="muted m-small">Вы вошли как {data.login} — тот же вход, что в LifeDashboard.</span>}
          <a className="btn btn-ghost" href="/task">
            Открыть LifeDashboard
          </a>
        </div>
      </main>
    </>
  );
}

const HUB: { href: string; module: string; icon: string; title: string; hint: (d: ReturnType<typeof useMoney>['data']) => string }[] = [
  { href: '/money/recurring', module: 'recurring', icon: 'repeat', title: 'Регулярные платежи', hint: (d) => (d.recurring.length ? `активных: ${d.recurring.filter((r) => r.active).length}` : 'Подписки, аренда, связь') },
  { href: '/money/debts', module: 'debts', icon: 'users', title: 'Долги', hint: (d) => (d.debts.some((x) => !x.closed) ? `открытых: ${d.debts.filter((x) => !x.closed).length}` : 'Кто кому должен') },
  { href: '/money/goals', module: 'goals', icon: 'flag', title: 'Цели', hint: (d) => (d.goals.length ? plural(d.goals.length, 'цель', 'цели', 'целей') : 'Копить на отпуск, подушку') },
  { href: '/money/import', module: 'import', icon: 'download', title: 'Импорт выписки', hint: () => 'Файл банка или скриншоты' },
  { href: '/money/sms', module: 'sms', icon: 'chat', title: 'SMS от банка', hint: (d) => (d.sms_on ? 'подключены' : 'Записывать покупки сами') },
];

/** Разделы «Денег», которые не в нижнем меню. */
function Hub() {
  const { data, shown } = useMoney();
  const items = HUB.filter((h) => shown(h.module));
  if (!items.length) return null;
  return (
    <div className="m-card" style={{ gap: 0, padding: '2px 14px' }}>
      {items.map((h) => (
        <Link key={h.href} className="m-op" href={h.href}>
          <span className="m-op-ic">
            <Icon name={h.icon} />
          </span>
          <span className="m-op-t">
            <b>{h.title}</b>
            <small>{h.hint(data)}</small>
          </span>
          <span className="muted m-flip" aria-hidden="true">
            <Icon name="back" size={18} />
          </span>
        </Link>
      ))}
    </div>
  );
}

/** Свой курс для валюты, которой нет у ЦБ: сколько рублей за 1. */
function UserRate({ code }: { code: string }) {
  const { data, reload, toast } = useMoney();
  const [text, setText] = useState(data.user_rates[code] ? String(data.user_rates[code]).replace('.', ',') : '');
  async function save() {
    const rate = Number(text.replace(/\s/g, '').replace(',', '.'));
    if (!(rate > 0)) return toast('Курс — положительное число, например 80,9.');
    try {
      await api('money/rates', 'POST', { currency: code, rate });
      await reload();
      toast(`Курс ${code} сохранён`);
    } catch (e) {
      toast((e as Error).message);
    }
  }
  return (
    <div className="m-field">
      <span className="label">
        {code} — у ЦБ нет курса. Рублей за 1 {currency(code).symbol ?? code}:
      </span>
      <div className="m-row">
        <input className="field" inputMode="decimal" aria-label={`Курс ${code}`} placeholder="80,90" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="btn btn-ghost" type="button" onClick={save}>
          Сохранить
        </button>
      </div>
    </div>
  );
}

function Categories({ kind, list }: { kind: 'expense' | 'income'; list: MoneyCategory[] }) {
  const { reload, toast } = useMoney();
  const [name, setName] = useState('');
  const [editing, setEditing] = useState<string | null>(null);
  const [editName, setEditName] = useState('');

  async function run(req: Promise<unknown>) {
    try {
      await req;
      await reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <div className="m-card" style={{ gap: 0, padding: '4px 14px 12px' }}>
      {list.map((c) =>
        editing === c.id ? (
          <form
            key={c.id}
            className="m-set"
            onSubmit={(e) => {
              e.preventDefault();
              run(api(`money/categories/${c.id}`, 'PATCH', { name: editName }));
              setEditing(null);
            }}
          >
            <input className="field" aria-label="Название категории" value={editName} maxLength={40} onChange={(e) => setEditName(e.target.value)} autoFocus />
            <button className="btn btn-primary" type="submit">
              OK
            </button>
          </form>
        ) : (
          <div key={c.id} className="m-set">
            <button
              type="button"
              className="m-link-row"
              onClick={() => {
                setEditing(c.id);
                setEditName(c.name);
              }}
            >
              {c.name}
            </button>
            <button className="icon-btn bare" type="button" aria-label={`Убрать «${c.name}»`} onClick={() => run(api(`money/categories/${c.id}`, 'PATCH', { archived: true }))}>
              <Icon name="trash" size={18} />
            </button>
          </div>
        ),
      )}
      <form
        className="m-row"
        style={{ marginTop: 8 }}
        onSubmit={(e) => {
          e.preventDefault();
          if (!name.trim()) return;
          run(api('money/categories', 'POST', { kind, name }));
          setName('');
        }}
      >
        <input className="field" aria-label="Новая категория" placeholder="Новая категория" value={name} maxLength={40} onChange={(e) => setName(e.target.value)} />
        <button className="btn btn-ghost" type="submit">
          Добавить
        </button>
      </form>
    </div>
  );
}
