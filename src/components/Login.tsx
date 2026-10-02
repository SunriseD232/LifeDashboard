'use client';

import { useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from './icons';

/**
 * Экран входа: логин и пароль. Регистрации здесь нет — пользователей заводит
 * scripts/add-user.mjs на сервере (см. src/lib/auth.ts).
 */
export default function Login({ onDone }: { onDone: () => void }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api('auth/login', 'POST', { login, password });
      onDone();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="page" style={{ display: 'grid', placeItems: 'center', minHeight: '80vh', margin: '0 auto' }}>
      <form
        className="panel"
        onSubmit={submit}
        style={{ width: '100%', maxWidth: 400, padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}
      >
        <span className="brand-mark" style={{ width: 48, height: 48, borderRadius: 14 }}>
          <Icon name="bag" size={26} strokeWidth={2} />
        </span>
        <h1 className="display" style={{ margin: 0, fontSize: 28 }}>
          LifeDashboard
        </h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>Чек-листы для сборов и напоминания на день.</p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label className="label" htmlFor="login-name">
            Логин
          </label>
          <input
            id="login-name"
            className="field"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={64}
            value={login}
            onChange={(e) => setLogin(e.target.value)}
          />
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <label className="label" htmlFor="login-password">
            Пароль
          </label>
          <input
            id="login-password"
            className="field"
            type="password"
            autoComplete="current-password"
            required
            maxLength={200}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {error && (
          <p role="alert" style={{ margin: 0, color: 'var(--danger)' }}>
            {error}
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Входим…' : 'Войти'}
        </button>
      </form>
    </main>
  );
}
