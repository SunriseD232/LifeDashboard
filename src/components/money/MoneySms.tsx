'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { money } from '@/lib/currencies';
import { useMoney } from './MoneyShell';
import { SubHead } from './MoneyParts';

interface Status {
  on: boolean;
  account_id: string | null;
  created_at: string | null;
  last_used: string | null;
}

interface Preview {
  kind: 'expense' | 'income';
  amount_minor: number;
  currency: string;
  orig: { amount_minor: number; currency: string } | null;
  payee: string;
  account: string;
  card_last4: string | null;
  category_id: string | null;
}

const URL_ = 'https://media-watch.ru/task/api/money-sms';

function Copy({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="m-copy">
      <code className="mono">{value}</code>
      <button
        className="btn btn-ghost m-btn-sm"
        type="button"
        aria-label={`Скопировать: ${label}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(value);
            setDone(true);
            setTimeout(() => setDone(false), 1500);
          } catch {
            /* без доступа к буферу — выделите и скопируйте вручную */
          }
        }}
      >
        {done ? 'Скопировано' : 'Копировать'}
      </button>
    </div>
  );
}

/**
 * SMS от банка → операция сама. Автоматизация «Команд» iOS отправляет текст
 * каждого SMS банка сюда; ключ — вместо входа. Пуш-уведомления «Команды»
 * читать не умеют — только SMS.
 */
export default function MoneySms() {
  const { data, reload, toast } = useMoney();
  const [status, setStatus] = useState<Status | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [accountId, setAccountId] = useState('');
  const [sample, setSample] = useState('');
  const [preview, setPreview] = useState<Preview | null | 'none'>(null);
  const accounts = data.accounts.filter((a) => !a.archived);

  const load = () =>
    api<Status>('money/sms').then((s) => {
      setStatus(s);
      setAccountId(s.account_id ?? '');
    });
  useEffect(() => {
    load().catch(() => setStatus({ on: false, account_id: null, created_at: null, last_used: null }));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  async function create() {
    if (status?.on && !confirm('Старый ключ перестанет работать — автоматизацию придётся обновить. Создать новый?')) return;
    try {
      const r = await api<{ token: string }>('money/sms', 'POST', { account_id: accountId || null });
      setToken(r.token);
      await load();
      await reload();
    } catch (e) {
      toast((e as Error).message);
    }
  }
  async function off() {
    if (!confirm('Отключить? Автоматизация перестанет записывать операции.')) return;
    await api('money/sms', 'DELETE');
    setToken(null);
    await load();
    await reload();
  }
  async function test() {
    if (!sample.trim()) return;
    try {
      const r = await api<{ op: Preview | null }>('money/sms/preview', 'POST', { text: sample });
      setPreview(r.op ?? 'none');
    } catch (e) {
      toast((e as Error).message);
    }
  }

  return (
    <>
      <SubHead title="SMS от банка" />
      <main className="m-main">
        <section className="m-card" style={{ gap: 10 }}>
          <p style={{ margin: 0 }}>
            Приходит SMS о покупке — операция записывается сама: сумма, место, карта, категория как в прошлый раз. Работает через приложение «Команды» на iPhone.
          </p>
          <p className="muted m-small" style={{ margin: 0 }}>
            Только SMS: пуш-уведомления банков «Команды» читать не умеют. Если банк присылает пуши — включите в нём SMS-информирование или загружайте выписку.
          </p>
        </section>

        <section className="m-card" style={{ gap: 10 }}>
          <h2 className="m-card-title">1. Ключ</h2>
          {status?.on && !token && (
            <p className="muted m-small" style={{ margin: 0 }}>
              Ключ создан{status.last_used ? `, последнее SMS — ${new Date(`${status.last_used}Z`).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}` : ', SMS ещё не приходили'}. Сам ключ показывается один раз — потеряли, создайте новый.
            </p>
          )}
          <label className="m-field">
            <span className="label">Счёт, если в SMS нет последних цифр карты</span>
            <select
              className="field"
              value={accountId}
              onChange={async (e) => {
                setAccountId(e.target.value);
                if (status?.on) await api('money/sms', 'PATCH', { account_id: e.target.value || null });
              }}
            >
              <option value="">Первый подходящий</option>
              {accounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name} · {a.currency}
                  {a.card_last4 ? ` · *${a.card_last4}` : ''}
                </option>
              ))}
            </select>
            <span className="muted m-small">Цифры карты для каждого счёта — в «Счетах». По ним SMS сама попадёт куда нужно.</span>
          </label>
          {token ? (
            <>
              <p className="m-small" style={{ margin: 0 }}>
                Ключ — скопируйте сейчас, второй раз он не покажется:
              </p>
              <Copy value={`Bearer ${token}`} label="ключ" />
            </>
          ) : (
            <div className="m-row">
              <button className="btn btn-primary" type="button" onClick={create} style={{ flex: 1 }}>
                {status?.on ? 'Создать новый ключ' : 'Создать ключ'}
              </button>
              {status?.on && (
                <button className="btn btn-danger-ghost" type="button" onClick={off}>
                  Отключить
                </button>
              )}
            </div>
          )}
        </section>

        <section className="m-card m-steps" style={{ gap: 8 }}>
          <h2 className="m-card-title">2. Автоматизация в «Командах»</h2>
          <ol>
            <li>Откройте «Команды» → «Автоматизация» → «+» → «Сообщение».</li>
            <li>
              «Отправитель» — номер банка (Сбер — 900, у других — их имя в Сообщениях). «Сообщение содержит» можно не заполнять. Выберите <b>«Запускать сразу»</b> → «Далее» → «Новая пустая автоматизация».
            </li>
            <li>
              Добавьте действие <b>«Получить содержимое URL»</b>, адрес:
              <Copy value={URL_} label="адрес" />
            </li>
            <li>
              Нажмите «›»: <b>Метод</b> — POST. <b>Заголовки</b> → «Добавить»: ключ <code>Authorization</code>, значение — ключ из шага 1 (начинается с <code>Bearer</code>).
            </li>
            <li>
              <b>Текст запроса</b> — JSON → «Добавить поле» → «Текст»: ключ <code>text</code>, значение — переменная <b>«Ввод быстрой команды»</b> (сообщение целиком).
            </li>
            <li>Готово. Отправьте себе тестовое SMS или дождитесь покупки — операция появится в «Деньгах».</li>
          </ol>
        </section>

        <section className="m-card" style={{ gap: 10 }}>
          <h2 className="m-card-title">3. Проверить на своём SMS</h2>
          <textarea className="field" rows={3} placeholder="Вставьте текст SMS банка" value={sample} onChange={(e) => (setSample(e.target.value), setPreview(null))} />
          <button className="btn btn-ghost" type="button" onClick={test} disabled={!sample.trim()}>
            Что получится
          </button>
          {preview === 'none' && <p className="m-error" style={{ margin: 0 }}>Не похоже на операцию — такое SMS пропустим (коды, отказы и реклама не записываются).</p>}
          {preview && preview !== 'none' && (
            <div className="m-kv-box">
              <div className="m-kv">
                <span className="muted">{preview.kind === 'expense' ? 'Трата' : 'Поступление'}</span>
                <span className="mono">
                  {money(preview.amount_minor, preview.currency)}
                  {preview.orig ? ` (${money(preview.orig.amount_minor, preview.orig.currency)})` : ''}
                </span>
              </div>
              <div className="m-kv">
                <span className="muted">Где</span>
                <span>{preview.payee || '—'}</span>
              </div>
              <div className="m-kv">
                <span className="muted">Счёт</span>
                <span>
                  {preview.account}
                  {preview.card_last4 ? ` (карта *${preview.card_last4})` : ''}
                </span>
              </div>
              <div className="m-kv">
                <span className="muted">Категория</span>
                <span>{data.categories.find((c) => c.id === preview.category_id)?.name ?? 'без категории'}</span>
              </div>
            </div>
          )}
        </section>
      </main>
    </>
  );
}
