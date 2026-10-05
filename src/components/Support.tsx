'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from './AppShell';
import Confirm from './Confirm';
import { Icon } from './icons';

type Kind = 'idea' | 'bug' | 'question' | 'other';
type Status = 'new' | 'in_progress' | 'done';

interface Feedback {
  id: string;
  kind: Kind;
  text: string;
  page: string | null;
  status: Status;
  reply: string | null;
  created_at: string;
  login?: string;
}

const KINDS: { id: Kind; label: string; hint: string }[] = [
  { id: 'idea', label: 'Идея', hint: 'Чего не хватает, что сделать удобнее' },
  { id: 'bug', label: 'Ошибка', hint: 'Что нажали, что ждали и что вышло' },
  { id: 'question', label: 'Вопрос', hint: 'Как что-то сделать' },
  { id: 'other', label: 'Другое', hint: '' },
];
const KIND_LABEL = Object.fromEntries(KINDS.map((k) => [k.id, k.label])) as Record<Kind, string>;
const STATUS_LABEL: Record<Status, string> = { new: 'Новое', in_progress: 'В работе', done: 'Готово' };

/** Устройство и экран — чтобы ошибку на iPhone можно было повторить. */
function deviceInfo(): string {
  const ua = navigator.userAgent;
  const os = /iPhone|iPad/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : 'другое';
  const standalone = window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone;
  return `${os} · ${window.innerWidth}×${window.innerHeight}${standalone ? ' · с экрана «Домой»' : ''}`;
}

const when = (s: string) => new Date(`${s.replace(' ', 'T')}Z`).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

/**
 * Поддержка: отзыв, ошибка или вопрос — и ответы на них. Админ (ADMIN_LOGINS)
 * видит ещё и все обращения: статус и ответ, автору уходит письмо.
 */
export default function Support() {
  const { toast } = useApp();
  const [kind, setKind] = useState<Kind>('idea');
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [list, setList] = useState<{ admin: boolean; mine: Feedback[]; inbox: Feedback[] | null } | null>(null);

  const load = useCallback(async () => {
    try {
      setList(await api('support'));
    } catch (e) {
      toast((e as Error).message);
    }
  }, [toast]);
  useEffect(() => {
    load();
  }, [load]);

  const send = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    setBusy(true);
    try {
      await api('support', 'POST', { kind, text: text.trim(), page: deviceInfo() });
      setText('');
      toast('Спасибо! Получили — ответ появится здесь и придёт на почту');
      await load();
    } catch (err) {
      toast((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="page-head">
        <h1 className="h1 display">Поддержка</h1>
      </div>
      <div className="support-grid">
        <form className="card" onSubmit={send} aria-labelledby="sup-new">
          <h2 className="card-title display" id="sup-new">
            <Icon name="chat" />
            Написать нам
          </h2>
          <p style={{ margin: 0, fontSize: 'calc(14px * var(--fs))', color: 'var(--muted)' }}>
            Читаем всё. Нашли ошибку, не хватает функции или непонятно, как что-то сделать — расскажите. Сначала можно заглянуть в <Link href="/guide">«Как пользоваться»</Link>.
          </p>
          <div role="radiogroup" aria-label="О чём" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            {KINDS.map((k) => (
              <button key={k.id} type="button" className="chip" role="radio" aria-checked={kind === k.id} aria-pressed={kind === k.id} onClick={() => setKind(k.id)}>
                {k.label}
              </button>
            ))}
          </div>
          <label className="sr-only" htmlFor="sup-text">
            Сообщение
          </label>
          <textarea id="sup-text" className="field" rows={6} maxLength={4000} required placeholder={KINDS.find((k) => k.id === kind)?.hint || 'Ваше сообщение'} value={text} onChange={(e) => setText(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={busy || !text.trim()} style={{ alignSelf: 'flex-start' }}>
            <Icon name="check" size={18} />
            {busy ? 'Отправляем…' : 'Отправить'}
          </button>
        </form>

        <section className="card" aria-labelledby="sup-mine">
          <h2 className="card-title display" id="sup-mine">
            Мои обращения
          </h2>
          {!list ? (
            <p style={{ margin: 0, color: 'var(--muted)' }}>Загружаем…</p>
          ) : list.mine.length === 0 ? (
            <p style={{ margin: 0, color: 'var(--muted)', fontSize: 'calc(14px * var(--fs))' }}>Пока ничего. Ответы на обращения появятся здесь.</p>
          ) : (
            list.mine.map((f) => <Item key={f.id} f={f} onDeleted={load} />)
          )}
        </section>
      </div>

      {list?.inbox && <Inbox items={list.inbox} onChanged={load} />}
    </>
  );
}

/** Удалить обращение — с подтверждением. */
function DeleteButton({ f, onDeleted }: { f: Feedback; onDeleted: () => Promise<void> }) {
  const { toast } = useApp();
  const [confirm, setConfirm] = useState(false);
  return (
    <>
      <button className="icon-btn bare" type="button" aria-label="Удалить обращение" title="Удалить обращение" onClick={() => setConfirm(true)} style={{ marginLeft: 'auto' }}>
        <Icon name="trash" size={16} />
      </button>
      {confirm && (
        <Confirm
          title="Удалить обращение?"
          text={f.reply ? 'Удалится вместе с ответом поддержки.' : 'Сообщение удалится насовсем.'}
          action="Удалить"
          onCancel={() => setConfirm(false)}
          onConfirm={async () => {
            setConfirm(false);
            try {
              await api(`support/${f.id}`, 'DELETE');
              toast('Обращение удалено');
              await onDeleted();
            } catch (e) {
              toast((e as Error).message);
            }
          }}
        />
      )}
    </>
  );
}

function Item({ f, onDeleted }: { f: Feedback; onDeleted?: () => Promise<void> }) {
  return (
    <article className="sup-item">
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', fontSize: 'calc(13px * var(--fs))' }}>
        <span className="tag">{KIND_LABEL[f.kind]}</span>
        <span className="sup-status" data-status={f.status}>
          {STATUS_LABEL[f.status]}
        </span>
        <span style={{ color: 'var(--muted)' }}>{when(f.created_at)}</span>
        {f.login && <span style={{ color: 'var(--muted)' }}>· {f.login}</span>}
        {onDeleted && <DeleteButton f={f} onDeleted={onDeleted} />}
      </div>
      <p style={{ margin: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{f.text}</p>
      {f.reply && (
        <div className="sup-reply">
          <b style={{ fontWeight: 600 }}>Ответ:</b> <span style={{ whiteSpace: 'pre-wrap' }}>{f.reply}</span>
        </div>
      )}
    </article>
  );
}

function Inbox({ items, onChanged }: { items: Feedback[]; onChanged: () => Promise<void> }) {
  const [filter, setFilter] = useState<Status | 'all'>('new');
  const shown = items.filter((f) => filter === 'all' || f.status === filter);
  const count = (s: Status) => items.filter((f) => f.status === s).length;
  return (
    <section className="card" aria-labelledby="sup-inbox" style={{ marginTop: 20 }}>
      <h2 className="card-title display" id="sup-inbox">
        Все обращения · админ
      </h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
        {(['new', 'in_progress', 'done'] as Status[]).map((s) => (
          <button key={s} type="button" className="chip" aria-pressed={filter === s} onClick={() => setFilter(s)}>
            {STATUS_LABEL[s]} · {count(s)}
          </button>
        ))}
        <button type="button" className="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>
          Все · {items.length}
        </button>
      </div>
      {shown.length === 0 && <p style={{ margin: 0, color: 'var(--muted)', fontSize: 'calc(14px * var(--fs))' }}>Здесь пусто.</p>}
      {shown.map((f) => (
        <AdminItem key={f.id} f={f} onChanged={onChanged} />
      ))}
    </section>
  );
}

function AdminItem({ f, onChanged }: { f: Feedback; onChanged: () => Promise<void> }) {
  const { toast } = useApp();
  const [reply, setReply] = useState(f.reply ?? '');
  const [busy, setBusy] = useState(false);
  const save = async (patch: { status?: Status; reply?: string }) => {
    setBusy(true);
    try {
      await api(`support/${f.id}`, 'PATCH', patch);
      await onChanged();
      toast(patch.reply !== undefined ? 'Ответ сохранён, автору ушло письмо' : 'Статус обновлён');
    } catch (e) {
      toast((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="sup-item">
      <Item f={{ ...f, reply: null }} onDeleted={onChanged} />
      {f.page && <span style={{ fontSize: 'calc(12px * var(--fs))', color: 'var(--muted)' }}>{f.page}</span>}
      <label className="sr-only" htmlFor={`rep-${f.id}`}>
        Ответ
      </label>
      <textarea id={`rep-${f.id}`} className="field" rows={2} maxLength={4000} placeholder="Ответ автору" value={reply} onChange={(e) => setReply(e.target.value)} />
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
        <button className="btn btn-primary" type="button" disabled={busy || reply.trim() === (f.reply ?? '')} onClick={() => save({ reply: reply.trim(), status: f.status === 'new' ? 'in_progress' : f.status })}>
          Ответить
        </button>
        <label className="sr-only" htmlFor={`st-${f.id}`}>
          Статус
        </label>
        <select id={`st-${f.id}`} className="field" style={{ width: 'auto' }} value={f.status} disabled={busy} onChange={(e) => save({ status: e.target.value as Status })}>
          {(['new', 'in_progress', 'done'] as Status[]).map((s) => (
            <option key={s} value={s}>
              {STATUS_LABEL[s]}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}
