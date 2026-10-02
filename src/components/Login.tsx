'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { Icon } from './icons';

type Mode = 'login' | 'register' | 'reset';

const RESEND_SEC = 60;

/**
 * Вход, регистрация и сброс пароля. Регистрация и сброс — в два шага: почта
 * → код из письма и пароль (src/server/api/auth.ts). После них человек сразу
 * внутри.
 */
export default function Login({ onDone }: { onDone: () => void }) {
  const [mode, setMode] = useState<Mode>('login');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [resendIn, setResendIn] = useState(0);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = setTimeout(() => setResendIn(resendIn - 1), 1000);
    return () => clearTimeout(t);
  }, [resendIn]);

  const switchTo = (m: Mode) => {
    setMode(m);
    setStep('email');
    setCode('');
    setPassword('');
    setError(null);
    setInfo(null);
  };

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const sendCode = () =>
    run(async () => {
      const r = await api<{ message: string }>(`auth/${mode}/start`, 'POST', { email });
      setInfo(r.message);
      setStep('code');
      setResendIn(RESEND_SEC);
    });

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (mode === 'login') {
      run(async () => {
        await api('auth/login', 'POST', { login: email, password });
        onDone();
      });
    } else if (step === 'email') {
      sendCode();
    } else {
      run(async () => {
        await api(`auth/${mode}/finish`, 'POST', { email, code, password });
        onDone();
      });
    }
  };

  const action =
    mode === 'login' ? 'Войти' : step === 'email' ? 'Прислать код' : mode === 'register' ? 'Создать аккаунт' : 'Сменить пароль и войти';

  return (
    <main className="page" style={{ display: 'grid', placeItems: 'center', minHeight: '80vh', margin: '0 auto' }}>
      <form className="panel" onSubmit={submit} style={{ width: '100%', maxWidth: 400, padding: 28, display: 'flex', flexDirection: 'column', gap: 14 }}>
        <span className="brand-mark" style={{ width: 48, height: 48, borderRadius: 14 }}>
          <Icon name="bag" size={26} strokeWidth={2} />
        </span>
        <h1 className="display" style={{ margin: 0, fontSize: 28 }}>
          LifeDashboard
        </h1>
        <p style={{ margin: 0, color: 'var(--muted)' }}>Дела, чек-листы, напоминания, кухня и тренировки — в одном месте.</p>

        {mode === 'reset' ? (
          <h2 className="display" style={{ margin: 0, fontSize: 20 }}>
            Новый пароль
          </h2>
        ) : (
          <div className="tabs-row" role="group" aria-label="Вход или регистрация" style={{ alignSelf: 'stretch' }}>
            <button type="button" aria-pressed={mode === 'login'} style={{ flex: 1, justifyContent: 'center' }} onClick={() => switchTo('login')}>
              Вход
            </button>
            <button type="button" aria-pressed={mode === 'register'} style={{ flex: 1, justifyContent: 'center' }} onClick={() => switchTo('register')}>
              Регистрация
            </button>
          </div>
        )}

        <div className="fld">
          <label className="label" htmlFor="auth-email">
            {mode === 'login' ? 'Почта или логин' : 'Почта'}
          </label>
          <input
            id="auth-email"
            className="field"
            type={mode === 'login' ? 'text' : 'email'}
            autoComplete={mode === 'login' ? 'username' : 'email'}
            autoCapitalize="none"
            spellCheck={false}
            required
            maxLength={64}
            readOnly={mode !== 'login' && step === 'code'}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </div>

        {mode !== 'login' && step === 'code' && (
          <>
            {info && (
              <p role="status" style={{ margin: 0, fontSize: 14, color: 'var(--muted)' }}>
                {info}
              </p>
            )}
            <div className="fld">
              <label className="label" htmlFor="auth-code">
                Код из письма
              </label>
              <input
                id="auth-code"
                className="field mono"
                inputMode="numeric"
                autoComplete="one-time-code"
                required
                maxLength={7}
                placeholder="000000"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/[^\d ]/g, ''))}
              />
            </div>
          </>
        )}

        {(mode === 'login' || step === 'code') && (
          <div className="fld">
            <label className="label" htmlFor="auth-password">
              {mode === 'login' ? 'Пароль' : 'Придумайте пароль'}
            </label>
            <input
              id="auth-password"
              className="field"
              type="password"
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              required
              minLength={mode === 'login' ? undefined : 8}
              maxLength={200}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              aria-describedby={mode === 'login' ? undefined : 'auth-pw-hint'}
            />
            {mode !== 'login' && (
              <span id="auth-pw-hint" style={{ fontSize: 13, color: 'var(--muted)' }}>
                Не короче 8 символов.
              </span>
            )}
          </div>
        )}

        {error && (
          <p role="alert" style={{ margin: 0, color: 'var(--danger)' }}>
            {error}
          </p>
        )}

        <button className="btn btn-primary" type="submit" disabled={busy}>
          {busy ? 'Минутку…' : action}
        </button>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', fontSize: 14 }}>
          {mode === 'login' && (
            <button type="button" className="link-btn" onClick={() => switchTo('reset')}>
              Забыли пароль?
            </button>
          )}
          {mode !== 'login' && step === 'code' && (
            <>
              <button type="button" className="link-btn" disabled={resendIn > 0 || busy} onClick={sendCode}>
                {resendIn > 0 ? `Отправить код ещё раз через ${resendIn} с` : 'Отправить код ещё раз'}
              </button>
              <button type="button" className="link-btn" onClick={() => setStep('email')}>
                Другая почта
              </button>
            </>
          )}
          {mode === 'reset' && (
            <button type="button" className="link-btn" onClick={() => switchTo('login')}>
              Вернуться ко входу
            </button>
          )}
        </div>
      </form>
    </main>
  );
}
