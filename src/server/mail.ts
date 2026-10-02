import nodemailer, { type Transporter } from 'nodemailer';
import { CODE_TTL_MIN, type Purpose } from './emailCodes';
import { HttpError } from './http';

/**
 * Отправка писем через SMTP сервиса рассылок (Unisender Go, SendPulse,
 * Mailgun… — у всех есть SMTP). Настройки — в /opt/lifedashboard/.env:
 *
 *   SMTP_HOST=smtp.go1.unisender.ru
 *   SMTP_PORT=587            # 465 — сразу TLS, 587 — STARTTLS
 *   SMTP_USER=…
 *   SMTP_PASS=…
 *   MAIL_FROM="LifeDashboard <noreply@media-watch.ru>"
 *
 * Адрес отправителя должен быть подтверждён в сервисе (записи SPF/DKIM у
 * домена), иначе письма уйдут в спам или не уйдут вовсе.
 *
 * Без настроек: в разработке код печатается в консоль сервера, в
 * продакшене — понятная ошибка.
 */

let transport: Transporter | null | undefined;

function getTransport(): Transporter | null {
  if (transport !== undefined) return transport;
  const host = process.env.SMTP_HOST;
  if (!host || !process.env.MAIL_FROM) return (transport = null);
  const port = Number(process.env.SMTP_PORT || 587);
  transport = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
  });
  return transport;
}

async function send(to: string, subject: string, text: string): Promise<void> {
  const t = getTransport();
  if (!t) {
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[lifedashboard mail] (SMTP не настроен) → ${to}: ${subject}\n${text}`);
      return;
    }
    throw new HttpError(503, 'Отправка почты пока не настроена. Напишите администратору.');
  }
  try {
    await t.sendMail({ from: process.env.MAIL_FROM, to, subject, text });
  } catch (e) {
    console.error('[lifedashboard mail] не отправилось:', (e as Error).message);
    throw new HttpError(502, 'Не удалось отправить письмо. Попробуйте ещё раз чуть позже.');
  }
}

export function sendCode(to: string, code: string, purpose: Purpose): Promise<void> {
  const what = purpose === 'register' ? 'регистрации' : 'сброса пароля';
  return send(
    to,
    `${code} — код для ${what} в LifeDashboard`,
    [
      `Ваш код для ${what} в LifeDashboard: ${code}`,
      '',
      `Код действует ${CODE_TTL_MIN} минут. Если вы его не запрашивали — просто удалите письмо.`,
      '',
      'https://media-watch.ru/task',
    ].join('\n'),
  );
}

/** Регистрируются на уже занятую почту — пишем владельцу, а не выдаём это на экране. */
export function sendAlreadyRegistered(to: string): Promise<void> {
  return send(
    to,
    'Вход в LifeDashboard',
    [
      'Кто-то (возможно, вы) пытался зарегистрироваться в LifeDashboard с этой почтой, но аккаунт у вас уже есть.',
      '',
      'Войдите с паролем или, если забыли его, нажмите «Забыли пароль?» на странице входа.',
      '',
      'https://media-watch.ru/task',
    ].join('\n'),
  );
}
