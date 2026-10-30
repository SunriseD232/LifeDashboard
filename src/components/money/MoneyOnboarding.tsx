'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { CURRENCIES, currency, parseAmount, POPULAR } from '@/lib/currencies';
import { plural } from '@/lib/dates';

/**
 * Первый запуск «Денег»: основная валюта (в ней итоги), какими ещё
 * пользуется человек, и первый счёт — чтобы сразу записать трату.
 */
export default function MoneyOnboarding({ onDone }: { onDone: () => void }) {
  const [step, setStep] = useState<1 | 2>(1);
  const [base, setBase] = useState('RUB');
  const [picked, setPicked] = useState<string[]>(['USD', 'EUR']);
  const [query, setQuery] = useState('');
  const [name, setName] = useState('Карта');
  const [opening, setOpening] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const q = query.trim().toLowerCase();
  const list = q
    ? CURRENCIES.filter((c) => c.code !== base && (c.code.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)))
    : [...POPULAR.map((p) => currency(p)), ...CURRENCIES.filter((c) => !POPULAR.includes(c.code))].filter((c) => c.code !== base);
  const count = picked.filter((c) => c !== base).length + 1;

  const toggle = (code: string) => setPicked((p) => (p.includes(code) ? p.filter((c) => c !== code) : [...p, code]));

  async function finish() {
    const opening_minor = opening.trim() ? parseAmount(opening.replace(/^[−-]/, ''), base) : 0;
    if (opening_minor === null) return setError('Не понял остаток — введите число, например 15 000.');
    setBusy(true);
    setError(null);
    try {
      await api('money/onboard', 'POST', {
        base_currency: base,
        currencies: picked.filter((c) => c !== base),
        account: { name: name.trim() || 'Карта', currency: base, opening_minor: /^[−-]/.test(opening.trim()) ? -opening_minor : opening_minor },
      });
      onDone();
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (step === 2) {
    return (
      <main className="m-onb">
        <header className="m-onb-head">
          <div className="muted m-small">Шаг 2 из 2</div>
          <h1 className="display m-h1">Первый счёт</h1>
          <p className="muted" style={{ margin: 0 }}>
            Куда записывать траты. Остальные счета — карты, наличные, вклады — добавите потом.
          </p>
        </header>
        <div className="m-card" style={{ gap: 14 }}>
          <label className="m-field">
            <span className="label">Название</span>
            <input className="field" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} />
          </label>
          <label className="m-field">
            <span className="label">Сколько на нём сейчас, {currency(base).symbol ?? base}</span>
            <input className="field" inputMode="decimal" placeholder="0" value={opening} onChange={(e) => setOpening(e.target.value)} />
          </label>
        </div>
        {error && (
          <p className="m-error" role="alert">
            {error}
          </p>
        )}
        <div className="m-onb-foot">
          <button className="btn btn-ghost" type="button" onClick={() => setStep(1)}>
            Назад
          </button>
          <button className="btn btn-primary" type="button" disabled={busy} onClick={finish} style={{ flex: 1 }}>
            Готово
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="m-onb">
      <header className="m-onb-head">
        <div className="muted m-small">Шаг 1 из 2</div>
        <h1 className="display m-h1">Какие у вас валюты?</h1>
        <p className="muted" style={{ margin: 0 }}>
          Итоги считаем в основной. Курсы берём у ЦБ каждый день, поменять всё можно в настройках.
        </p>
      </header>
      <label className="m-field">
        <span className="group-title">Основная</span>
        <select className="field" value={base} onChange={(e) => setBase(e.target.value)}>
          {CURRENCIES.map((c) => (
            <option key={c.code} value={c.code}>
              {c.code} — {c.name}
            </option>
          ))}
        </select>
      </label>
      <div className="m-field">
        <span className="group-title">Ещё пользуетесь</span>
        <input className="field" type="search" aria-label="Найти валюту" placeholder="Доллар, EUR, тенге…" value={query} onChange={(e) => setQuery(e.target.value)} />
      </div>
      <div className="m-card m-list">
        {list.map((c) => (
          <label key={c.code} className="m-pick">
            <input type="checkbox" checked={picked.includes(c.code)} onChange={() => toggle(c.code)} />
            <span className="m-cur">{c.code}</span>
            <span className="m-pick-t">
              <b>{c.name}</b>
              {!c.cbr && <small>у ЦБ нет курса, укажете свой</small>}
            </span>
          </label>
        ))}
        {!list.length && <p className="muted" style={{ margin: '12px 0' }}>Такой валюты нет в списке.</p>}
      </div>
      <div className="m-onb-foot">
        <button className="btn btn-primary" type="button" onClick={() => setStep(2)} style={{ flex: 1 }}>
          Дальше · {plural(count, 'валюта', 'валюты', 'валют')}
        </button>
      </div>
    </main>
  );
}
