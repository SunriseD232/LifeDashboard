import { randomUUID } from 'node:crypto';
import { userLogin } from '@/lib/auth';
import { HttpError, text, type Ctx } from '../http';
import { sendMail } from '../mail';

const KINDS = new Set(['idea', 'bug', 'question', 'other']);
const STATUSES = new Set(['new', 'in_progress', 'done']);
const KIND_LABEL: Record<string, string> = { idea: 'Идея', bug: 'Ошибка', question: 'Вопрос', other: 'Другое' };

/** Кто разбирает обращения: логины из ADMIN_LOGINS (через запятую) в .env. */
export function isAdmin(login: string | null): boolean {
  if (!login) return false;
  return (process.env.ADMIN_LOGINS ?? '')
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean)
    .includes(login.toLowerCase());
}

interface Row {
  id: string;
  user_id: string;
  kind: string;
  text: string;
  page: string | null;
  status: string;
  reply: string | null;
  created_at: string;
  updated_at: string;
  login?: string;
}

/**
 * Поддержка: /api/support[/:id].
 *  GET           — мои обращения; админу — ещё и все (inbox);
 *  POST          { kind, text, page } — новое обращение (админам — письмо);
 *  PATCH :id     { status, reply } — только админ; автору — письмо об ответе.
 */
export async function support({ d, userId, method, body, id }: Ctx): Promise<unknown> {
  const me = userLogin(userId);
  const admin = isAdmin(me);

  if (method === 'GET' && !id) {
    const mine = d.prepare('select * from feedback where user_id = ? order by created_at desc limit 100').all(userId) as Row[];
    const inbox = admin
      ? (d
          .prepare(
            `select f.*, u.login from feedback f left join users u on u.id = f.user_id
             order by case f.status when 'new' then 0 when 'in_progress' then 1 else 2 end, f.created_at desc limit 300`,
          )
          .all() as Row[])
      : null;
    return { admin, mine, inbox };
  }

  if (method === 'POST' && !id) {
    if (!KINDS.has(body.kind)) throw new HttpError(400, 'Выберите, о чём обращение.');
    const msg = text(body.text, 4000, 'Сообщение')!;
    // Не больше 10 обращений в сутки от человека — защита от случайного флуда.
    const today = d.prepare("select count(*) as n from feedback where user_id = ? and created_at > datetime('now', '-1 day')").get(userId) as { n: number };
    if (today.n >= 10) throw new HttpError(429, 'Сегодня уже много обращений — давайте продолжим завтра.');
    const fid = randomUUID();
    d.prepare('insert into feedback (id, user_id, kind, text, page) values (?, ?, ?, ?, ?)').run(fid, userId, body.kind, msg, text(body.page, 200, 'Страница', true));
    // Админам — письмо, если почта настроена; не получилось — обращение всё равно сохранено.
    const to = (process.env.ADMIN_LOGINS ?? '').split(',').map((s) => s.trim()).filter((s) => s.includes('@'));
    if (to.length) {
      sendMail(to.join(', '), `LifeDashboard: ${KIND_LABEL[body.kind]} от ${me}`, `${msg}\n\nСтраница: ${body.page ?? '—'}\nРазобрать: https://media-watch.ru/task/support`).catch((e) =>
        console.error('[lifedashboard support] письмо админу:', (e as Error).message),
      );
    }
    return { id: fid };
  }

  if (method === 'PATCH' && id) {
    if (!admin) throw new HttpError(403, 'Отвечать может только поддержка.');
    const row = d.prepare('select f.*, u.login from feedback f left join users u on u.id = f.user_id where f.id = ?').get(id) as Row | undefined;
    if (!row) throw new HttpError(404, 'Обращение не найдено.');
    const status = body.status !== undefined ? (STATUSES.has(body.status) ? body.status : null) : row.status;
    if (!status) throw new HttpError(400, 'Неизвестный статус.');
    const reply = body.reply !== undefined ? text(body.reply, 4000, 'Ответ', true) : row.reply;
    d.prepare("update feedback set status = ?, reply = ?, updated_at = datetime('now') where id = ?").run(status, reply, row.id);
    // Новый ответ — письмо автору (если у него логин — почта).
    if (reply && reply !== row.reply && row.login?.includes('@')) {
      sendMail(row.login, 'Ответ поддержки LifeDashboard', `Вы писали:\n${row.text}\n\nОтвет:\n${reply}\n\nВсе обращения: https://media-watch.ru/task/support`).catch((e) =>
        console.error('[lifedashboard support] письмо автору:', (e as Error).message),
      );
    }
    return { ok: true };
  }

  return undefined;
}
