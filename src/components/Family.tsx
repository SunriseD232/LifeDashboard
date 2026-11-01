'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { useApp } from './AppShell';
import Confirm from './Confirm';
import { Icon } from './icons';

/** Какие события семьи присылать push (src/server/familyEvents.ts). */
const PUSH_KINDS = [
  { id: 'invite', label: 'Зовут в семью' },
  { id: 'assign', label: 'Мне поручили дело' },
  { id: 'shopping', label: 'Добавили в покупки' },
  { id: 'done', label: 'Кто-то сделал общее дело' },
];
const DEFAULT_PUSH = ['invite', 'assign', 'shopping'];

const hint = { margin: 0, fontSize: 'calc(14px * var(--fs))', color: 'var(--muted)' } as const;

/** Приглашения мне: принять или отклонить. Показываем в настройках и на главной. */
export function InviteList() {
  const { data, reload, toast } = useApp();
  const list = data.invites ?? [];
  if (!list.length) return null;
  const answer = async (id: string, accept: boolean) => {
    try {
      await api(`household/invites/${encodeURIComponent(id)}`, accept ? 'POST' : 'DELETE');
      await reload();
      toast(accept ? 'Вы в семье' : 'Приглашение отклонено');
    } catch (e) {
      toast((e as Error).message);
    }
  };
  return (
    <ul className="family-invites" aria-label="Приглашения в семью">
      {list.map((i) => (
        <li key={i.id}>
          <Icon name="users" size={20} />
          <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
            <b>{i.from}</b> зовёт вас в семью «{i.family}»
            {data.household && <small style={{ display: 'block', color: 'var(--muted)' }}>Чтобы принять, сначала выйдите из «{data.household.name}».</small>}
          </span>
          <button className="btn btn-ghost" type="button" onClick={() => answer(i.id, false)}>
            Отклонить
          </button>
          <button className="btn btn-primary" type="button" disabled={!!data.household} onClick={() => answer(i.id, true)}>
            Принять
          </button>
        </li>
      ))}
    </ul>
  );
}

/**
 * Семья в настройках: создать, позвать по логину (вступает человек сам —
 * приглашение ждёт его две недели), кто в семье, что присылать push.
 */
export default function FamilyCard() {
  const { data, reload, toast, mutate } = useApp();
  const hh = data.household;
  const [hhName, setHhName] = useState('Семья');
  const [login, setLogin] = useState('');
  const [leaving, setLeaving] = useState(false);
  const me = hh?.members.find((m) => m.me)?.login;
  const push = data.settings.family_push ?? DEFAULT_PUSH;

  const run = async (fn: () => Promise<unknown>, ok?: string) => {
    try {
      await fn();
      await reload();
      if (ok) toast(ok);
      return true;
    } catch (err) {
      toast((err as Error).message);
      return false;
    }
  };
  const togglePush = (id: string, on: boolean) => {
    const next = on ? [...push, id] : push.filter((x) => x !== id);
    mutate(
      (d) => ({ ...d, settings: { ...d.settings, family_push: next } }),
      () => api('settings', 'PATCH', { family_push: next }),
    );
  };

  return (
    <section className="card" aria-labelledby="set-family">
      <h2 className="card-title display" id="set-family">
        <Icon name="users" />
        Семья
      </h2>
      <InviteList />
      {!hh ? (
        <>
          <p style={hint}>Общие дела, напоминания, покупки, запасы, рецепты, отпуска и деньги с близкими. Создайте семью и позовите человека по логину — он примет приглашение у себя.</p>
          <form
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
            onSubmit={(e) => {
              e.preventDefault();
              run(() => api('household', 'POST', { name: hhName }), 'Семья создана');
            }}
          >
            <label className="sr-only" htmlFor="hh-name">
              Название
            </label>
            <input id="hh-name" className="field" style={{ maxWidth: 280 }} maxLength={60} value={hhName} onChange={(e) => setHhName(e.target.value)} />
            <button className="btn btn-primary" type="submit" disabled={!hhName.trim()}>
              <Icon name="plus" size={18} />
              Создать семью
            </button>
          </form>
        </>
      ) : (
        <>
          <div style={{ fontWeight: 600 }}>{hh.name}</div>
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column' }}>
            {hh.members.map((m) => (
              <li key={m.login} className="task-row" style={{ padding: '6px 0' }}>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere' }}>
                  {m.login}
                  {m.me && <span style={{ color: 'var(--muted)' }}> — это вы</span>}
                </span>
                {!m.me && (
                  <button
                    className="icon-btn bare"
                    type="button"
                    aria-label={`Убрать ${m.login} из семьи`}
                    onClick={() => run(() => api(`household/members/${encodeURIComponent(m.login)}`, 'DELETE'), `${m.login} больше не в семье`)}
                  >
                    <Icon name="x" size={18} />
                  </button>
                )}
              </li>
            ))}
            {(hh.invited ?? []).map((i) => (
              <li key={i.id} className="task-row" style={{ padding: '6px 0' }}>
                <span style={{ flex: 1, minWidth: 0, overflowWrap: 'anywhere', color: 'var(--muted)' }}>
                  {i.login} — приглашение ждёт ответа
                </span>
                <button
                  className="icon-btn bare"
                  type="button"
                  aria-label={`Отозвать приглашение для ${i.login}`}
                  onClick={() => run(() => api(`household/invites/${encodeURIComponent(i.id)}`, 'DELETE'), 'Приглашение отозвано')}
                >
                  <Icon name="x" size={18} />
                </button>
              </li>
            ))}
          </ul>
          <form
            style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}
            onSubmit={async (e) => {
              e.preventDefault();
              const who = login.trim();
              if (await run(() => api('household/members', 'POST', { login: who }), `Если «${who}» есть в LifeDashboard, приглашение уже у него`)) setLogin('');
            }}
          >
            <label className="sr-only" htmlFor="hh-login">
              Логин
            </label>
            <input id="hh-login" className="field" style={{ maxWidth: 280 }} placeholder="Логин человека" autoCapitalize="none" value={login} onChange={(e) => setLogin(e.target.value)} />
            <button className="btn btn-ghost" type="submit" disabled={!login.trim()}>
              <Icon name="plus" size={18} />
              Позвать
            </button>
            <span style={{ flex: 1 }} />
            <button className="btn btn-danger-ghost" type="button" onClick={() => setLeaving(true)}>
              Выйти из семьи
            </button>
          </form>
        </>
      )}

      <fieldset className="family-push">
        <legend className="label">Присылать уведомления</legend>
        {PUSH_KINDS.map((k) => (
          <label key={k.id} className="check" style={{ padding: '4px 0' }}>
            <input type="checkbox" checked={push.includes(k.id)} onChange={(e) => togglePush(k.id, e.target.checked)} />
            <span className="check-text">{k.label}</span>
          </label>
        ))}
        <p style={{ ...hint, fontSize: 'calc(13px * var(--fs))' }}>Несколько покупок подряд придут одним сообщением, в тихие часы — после них.</p>
      </fieldset>

      {leaving && me && (
        <Confirm
          title="Выйти из семьи?"
          text="Общие дела останутся у остальных, запасы и знание о продуктах — копией у вас. Если вы последний — семья удалится, общие дела станут личными у их авторов, а холодильник останется у вас."
          action="Выйти"
          onCancel={() => setLeaving(false)}
          onConfirm={() => {
            setLeaving(false);
            run(() => api(`household/members/${encodeURIComponent(me)}`, 'DELETE'), 'Вы вышли из семьи');
          }}
        />
      )}
    </section>
  );
}
