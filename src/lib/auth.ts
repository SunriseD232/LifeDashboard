import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { db } from './db';

/**
 * Вход в LifeDashboard — свой, без внешних сервисов.
 *
 * Пользователи и сессии лежат в своей базе (users, sessions — src/lib/db.ts).
 * Пароль хранится хэшем scrypt; сессия — случайный токен в httpOnly-куке, а в
 * базе только его sha256, так что утёкшая копия базы не даёт войти.
 *
 * Регистрации из интерфейса нет: сайт открыт в интернет, и любой мог бы
 * завести себе аккаунт. Пользователей заводит scripts/add-user.mjs на сервере
 * (формат хэша там тот же — меняя его здесь, поменяйте и там).
 */

export const SESSION_COOKIE = 'ld_session';
const SESSION_DAYS = 180;
/** Сессию, которой осталось меньше этого, продлеваем на полный срок. */
const RENEW_DAYS = 150;
const DAY_MS = 86_400_000;

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

function scryptAsync(password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number }) {
  return new Promise<Buffer>((resolve, reject) =>
    scrypt(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Формат: scrypt$N$r$p$соль(base64)$хэш(base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt, SCRYPT.keylen, SCRYPT);
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), key.toString('base64')].join('$');
}

async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, N, r, p, salt, hash] = stored.split('$');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const expected = Buffer.from(hash, 'base64');
  const key = await scryptAsync(password, Buffer.from(salt, 'base64'), expected.length, {
    N: Number(N),
    r: Number(r),
    p: Number(p),
  });
  return timingSafeEqual(key, expected);
}

/** Хэш-пустышка: для несуществующего логина считаем scrypt так же долго —
 *  по времени ответа не понять, есть ли такой пользователь. */
let dummyHash: Promise<string> | null = null;

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

// ---- защита от перебора: 5 неудач на логин или IP — пауза 15 минут ----
const MAX_FAILS = 5;
const LOCK_MS = 15 * 60_000;
const fails = new Map<string, { count: number; until: number }>();

function lockedFor(keys: string[]): number {
  const now = Date.now();
  let wait = 0;
  for (const k of keys) {
    const f = fails.get(k);
    if (f && f.count >= MAX_FAILS && f.until > now) wait = Math.max(wait, f.until - now);
  }
  return wait;
}

function noteFail(keys: string[]) {
  const now = Date.now();
  if (fails.size > 5000) fails.clear();
  for (const k of keys) {
    const f = fails.get(k);
    const count = f && f.until > now ? f.count + 1 : 1;
    fails.set(k, { count, until: now + LOCK_MS });
  }
}

export type LoginResult = { ok: true } | { ok: false; error: string; status: number };

/** Проверить логин и пароль и поставить куку сессии. */
export async function login(loginRaw: string, password: string, ip: string): Promise<LoginResult> {
  const loginName = loginRaw.trim().toLowerCase();
  const keys = [`login:${loginName}`, `ip:${ip}`];
  const wait = lockedFor(keys);
  if (wait > 0) {
    return { ok: false, status: 429, error: `Слишком много попыток. Попробуйте через ${Math.ceil(wait / 60_000)} мин.` };
  }

  const user = db().prepare('select id, password_hash from users where login = ?').get(loginName) as
    | { id: string; password_hash: string }
    | undefined;
  dummyHash ??= hashPassword(randomBytes(16).toString('hex'));
  const ok = await verifyPassword(password, user?.password_hash ?? (await dummyHash));
  if (!user || !ok) {
    noteFail(keys);
    return { ok: false, status: 401, error: 'Неверный логин или пароль.' };
  }
  keys.forEach((k) => fails.delete(k));
  startSession(user.id);
  return { ok: true };
}

/** Новая сессия и кука — после входа, регистрации или сброса пароля. */
export function startSession(userId: string): void {
  const token = randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * DAY_MS);
  const d = db();
  d.prepare('delete from sessions where expires_at < ?').run(new Date().toISOString());
  d.prepare('insert into sessions (token_hash, user_id, expires_at) values (?, ?, ?)').run(sha256(token), userId, expires.toISOString());
  setCookie(token, expires);
}

/** Выйти: удалить сессию из базы и куку из браузера. */
export function logout(): void {
  const token = cookies().get(SESSION_COOKIE)?.value;
  if (token) db().prepare('delete from sessions where token_hash = ?').run(sha256(token));
  cookies().set(SESSION_COOKIE, '', { path: '/task', maxAge: 0 });
}

function setCookie(token: string, expires: Date) {
  cookies().set(SESSION_COOKIE, token, {
    path: '/task',
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    expires,
  });
}

/** Кто пришёл — id пользователя по куке сессии, или null. */
export async function currentUserId(): Promise<string | null> {
  // Только для локальной разработки (next dev): проверить интерфейс без
  // входа. В сборке для сервера NODE_ENV === 'production', и эта ветка не
  // срабатывает, что бы ни лежало в окружении.
  if (process.env.NODE_ENV === 'development' && process.env.LD_DEV_USER) {
    return process.env.LD_DEV_USER;
  }

  const token = cookies().get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const d = db();
  const hash = sha256(token);
  const row = d.prepare('select user_id, expires_at from sessions where token_hash = ?').get(hash) as
    | { user_id: string; expires_at: string }
    | undefined;
  if (!row) return null;

  const left = Date.parse(row.expires_at) - Date.now();
  if (left <= 0) {
    d.prepare('delete from sessions where token_hash = ?').run(hash);
    return null;
  }
  // Пользуются — продлеваем: иначе раз в полгода выкидывало бы посреди дела.
  if (left < RENEW_DAYS * DAY_MS) {
    const expires = new Date(Date.now() + SESSION_DAYS * DAY_MS);
    d.prepare('update sessions set expires_at = ? where token_hash = ?').run(expires.toISOString(), hash);
    try {
      setCookie(token, expires);
    } catch {
      /* вызвано не из обработчика запроса — ставить некуда */
    }
  }
  return row.user_id;
}

/** Логин текущего пользователя — для шапки. */
export function userLogin(userId: string): string | null {
  const row = db().prepare('select login from users where id = ?').get(userId) as { login: string } | undefined;
  return row?.login ?? null;
}
