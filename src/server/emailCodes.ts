import type Database from 'better-sqlite3';
import { createHash, randomInt, randomUUID, timingSafeEqual } from 'node:crypto';

/**
 * Коды из писем — для регистрации и сброса пароля. Регистрация открытая,
 * поэтому всё с ограничениями:
 *  - код из 6 цифр, живёт CODE_TTL_MIN минут, хранится только хэш;
 *  - не больше MAX_ATTEMPTS попыток ввода на код, потом — новый код;
 *  - новый код на ту же почту — не чаще раза в RESEND_SEC секунд и не больше
 *    PER_EMAIL_HOUR в час; с одного IP — не больше PER_IP_HOUR в час;
 *  - новый код отменяет прежние.
 */

export type Purpose = 'register' | 'reset';

export const CODE_TTL_MIN = 10;
export const MAX_ATTEMPTS = 5;
export const RESEND_SEC = 60;
export const PER_EMAIL_HOUR = 5;
export const PER_IP_HOUR = 20;
/** Сколько новых аккаунтов в сутки на весь сайт — защита от массовых регистраций. */
export const SIGNUPS_PER_DAY = 50;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Почта в одном виде (нижний регистр, без пробелов) или null, если не похожа на адрес. */
export function normEmail(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const e = v.trim().toLowerCase();
  return e.length <= 64 && EMAIL_RE.test(e) ? e : null;
}

const hash = (email: string, code: string) => createHash('sha256').update(`${email}:${code}`).digest('hex');
const iso = (d: Date) => d.toISOString();

export type Issue = { ok: true; code: string } | { ok: false; status: number; error: string };

/** Выдать код: проверить частоту, отменить прежние, сохранить хэш нового. */
export function issueCode(d: Database.Database, email: string, purpose: Purpose, ip: string, now = new Date()): Issue {
  const hourAgo = iso(new Date(now.getTime() - 3600_000));
  const last = d
    .prepare('select created_at from email_codes where email = ? and purpose = ? order by created_at desc limit 1')
    .get(email, purpose) as { created_at: string } | undefined;
  if (last && now.getTime() - Date.parse(last.created_at) < RESEND_SEC * 1000) {
    const wait = Math.ceil((RESEND_SEC * 1000 - (now.getTime() - Date.parse(last.created_at))) / 1000);
    return { ok: false, status: 429, error: `Код уже отправлен. Новый можно запросить через ${wait} с.` };
  }
  const perEmail = (d.prepare('select count(*) as n from email_codes where email = ? and created_at > ?').get(email, hourAgo) as { n: number }).n;
  const perIp = (d.prepare('select count(*) as n from email_codes where ip = ? and created_at > ?').get(ip, hourAgo) as { n: number }).n;
  if (perEmail >= PER_EMAIL_HOUR || perIp >= PER_IP_HOUR) {
    return { ok: false, status: 429, error: 'Слишком много запросов кода. Попробуйте через час.' };
  }
  const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
  d.transaction(() => {
    // Отменяем прежние неиспользованные: действует только последний код.
    d.prepare('update email_codes set expires_at = ? where email = ? and purpose = ? and expires_at > ?').run(iso(now), email, purpose, iso(now));
    d.prepare('insert into email_codes (id, email, purpose, code_hash, expires_at, ip, created_at) values (?, ?, ?, ?, ?, ?, ?)').run(
      randomUUID(),
      email,
      purpose,
      hash(email, code),
      iso(new Date(now.getTime() + CODE_TTL_MIN * 60_000)),
      ip,
      iso(now),
    );
    // Старые записи больше не нужны даже для подсчёта частоты.
    d.prepare('delete from email_codes where created_at < ?').run(iso(new Date(now.getTime() - 2 * 86400_000)));
  })();
  return { ok: true, code };
}

export type Check = 'ok' | 'wrong' | 'expired' | 'locked';

/** Проверить код. Верный — гасится (второй раз не сработает). */
export function checkCode(d: Database.Database, email: string, purpose: Purpose, code: unknown, now = new Date()): Check {
  const row = d
    .prepare('select id, code_hash, expires_at, attempts from email_codes where email = ? and purpose = ? order by created_at desc limit 1')
    .get(email, purpose) as { id: string; code_hash: string; expires_at: string; attempts: number } | undefined;
  if (!row || row.expires_at <= iso(now)) return 'expired';
  if (row.attempts >= MAX_ATTEMPTS) return 'locked';
  const given = typeof code === 'string' ? code.replace(/\D/g, '') : '';
  const a = Buffer.from(hash(email, given), 'hex');
  const b = Buffer.from(row.code_hash, 'hex');
  if (given.length !== 6 || !timingSafeEqual(a, b)) {
    d.prepare('update email_codes set attempts = attempts + 1 where id = ?').run(row.id);
    return row.attempts + 1 >= MAX_ATTEMPTS ? 'locked' : 'wrong';
  }
  d.prepare('update email_codes set expires_at = ? where id = ?').run(iso(now), row.id);
  return 'ok';
}

export const CHECK_ERRORS: Record<Exclude<Check, 'ok'>, string> = {
  wrong: 'Неверный код.',
  expired: 'Код устарел — запросите новый.',
  locked: 'Слишком много неверных попыток — запросите новый код.',
};

/** Сколько аккаунтов заведено за последние сутки. */
export function signupsToday(d: Database.Database): number {
  return (d.prepare("select count(*) as n from users where created_at > datetime('now', '-1 day')").get() as { n: number }).n;
}
