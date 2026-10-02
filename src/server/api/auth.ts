import type Database from 'better-sqlite3';
import type { NextRequest } from 'next/server';
import { randomUUID } from 'node:crypto';
import { hashPassword, login, logout, startSession } from '@/lib/auth';
import { CHECK_ERRORS, checkCode, issueCode, normEmail, signupsToday, SIGNUPS_PER_DAY, type Purpose } from '../emailCodes';
import { HttpError, text } from '../http';
import { sendAlreadyRegistered, sendCode } from '../mail';

const SENT = { ok: true, message: 'Если адрес верный, письмо с кодом уже в пути. Проверьте и «Спам».' };

function password(v: unknown): string {
  if (typeof v !== 'string' || v.length < 8) throw new HttpError(400, 'Пароль — не короче 8 символов.');
  if (v.length > 200) throw new HttpError(400, 'Пароль слишком длинный.');
  return v;
}

function email(v: unknown): string {
  const e = normEmail(v);
  if (!e) throw new HttpError(400, 'Проверьте адрес почты.');
  return e;
}

const userByLogin = (d: Database.Database, login: string) =>
  d.prepare('select id from users where login = ?').get(login) as { id: string } | undefined;

/**
 * Вход и регистрация — до проверки сессии: /api/auth/…
 *  login            { login, password }
 *  logout
 *  register/start   { email }                    — код на почту;
 *  register/finish  { email, code, password }    — аккаунт и сразу вход;
 *  reset/start      { email }                    — код для сброса пароля;
 *  reset/finish     { email, code, password }    — новый пароль, старые сессии сброшены.
 *
 * Ответы на «start» одинаковые, есть аккаунт или нет: по ним нельзя узнать,
 * чья почта зарегистрирована. Владельцу занятой почты приходит письмо
 * «у вас уже есть аккаунт».
 */
export async function auth(d: Database.Database, req: NextRequest, body: Record<string, any>, id?: string, action?: string): Promise<unknown> {
  if (req.method !== 'POST') return undefined;
  // IP клиента ставит nginx; без него (локальный запуск) — общий ключ.
  const ip = req.headers.get('x-real-ip') ?? 'local';

  if (id === 'login') {
    const name = text(body.login, 64, 'Почта')!;
    if (typeof body.password !== 'string' || !body.password || body.password.length > 200) throw new HttpError(400, 'Введите пароль.');
    const r = await login(name, body.password, ip);
    if (!r.ok) throw new HttpError(r.status, r.error);
    return { ok: true };
  }
  if (id === 'logout') {
    logout();
    return { ok: true };
  }

  const purpose: Purpose | null = id === 'register' ? 'register' : id === 'reset' ? 'reset' : null;
  if (!purpose) return undefined;

  if (action === 'start') {
    const e = email(body.email);
    const exists = !!userByLogin(d, e);
    if (purpose === 'register' && !exists && signupsToday(d) >= SIGNUPS_PER_DAY) {
      throw new HttpError(429, 'Сегодня регистраций слишком много — попробуйте завтра.');
    }
    // Частоту считаем всегда, даже если писать не о чем: иначе по скорости
    // ответа и ограничениям можно было бы перебирать адреса.
    const issued = issueCode(d, e, purpose, ip);
    if (!issued.ok) throw new HttpError(issued.status, issued.error);
    if (purpose === 'register') {
      if (exists) await sendAlreadyRegistered(e);
      else await sendCode(e, issued.code, 'register');
    } else if (exists) {
      await sendCode(e, issued.code, 'reset');
    }
    return SENT;
  }

  if (action === 'finish') {
    const e = email(body.email);
    const pw = password(body.password);
    const res = checkCode(d, e, purpose, body.code);
    if (res !== 'ok') throw new HttpError(400, CHECK_ERRORS[res]);
    const hashed = await hashPassword(pw);
    const user = userByLogin(d, e);
    if (purpose === 'register') {
      if (user) throw new HttpError(409, 'Аккаунт с этой почтой уже есть — войдите или сбросьте пароль.');
      const uid = randomUUID();
      d.prepare('insert into users (id, login, password_hash) values (?, ?, ?)').run(uid, e, hashed);
      startSession(uid);
    } else {
      if (!user) throw new HttpError(400, CHECK_ERRORS.expired);
      d.transaction(() => {
        d.prepare('update users set password_hash = ? where id = ?').run(hashed, user.id);
        d.prepare('delete from sessions where user_id = ?').run(user.id);
      })();
      startSession(user.id);
    }
    return { ok: true };
  }

  return undefined;
}
