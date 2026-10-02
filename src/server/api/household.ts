import { randomUUID } from 'node:crypto';
import { householdOf } from '../household';
import { HttpError, text, type Ctx } from '../http';

/**
 * Семья: /api/household[/members[/:login]].
 *  POST            { name }  — создать (если ещё не в семье);
 *  PATCH           { name }  — переименовать;
 *  POST  members   { login } — добавить человека (у него должен быть
 *                              аккаунт — их заводит scripts/add-user.mjs);
 *  DELETE members/:login     — убрать человека; свой логин — выйти.
 * Ушёл последний — семья удаляется, а её общие дела становятся личными у
 * своих авторов (внешний ключ on delete set null).
 */
export function household({ d, userId, method, body, id, action }: Ctx): unknown {
  const hh = householdOf(d, userId);

  if (method === 'POST' && !id) {
    if (hh) throw new HttpError(409, 'Вы уже в семье.');
    const hid = randomUUID();
    d.transaction(() => {
      d.prepare('insert into households (id, name, created_by) values (?, ?, ?)').run(hid, text(body.name, 60, 'Название'), userId);
      d.prepare('insert into household_members (user_id, household_id) values (?, ?)').run(userId, hid);
    })();
    return { id: hid };
  }

  if (!hh) throw new HttpError(404, 'Вы не в семье.');

  if (method === 'PATCH' && !id) {
    d.prepare('update households set name = ? where id = ?').run(text(body.name, 60, 'Название'), hh);
    return { ok: true };
  }

  if (method === 'POST' && id === 'members' && !action) {
    const login = text(body.login, 64, 'Логин')!.toLowerCase();
    const u = d.prepare('select id from users where login = ?').get(login) as { id: string } | undefined;
    if (!u) throw new HttpError(404, `Пользователя «${login}» нет. Аккаунт заводится на сервере — scripts/add-user.mjs.`);
    const other = householdOf(d, u.id);
    if (other === hh) return { ok: true };
    if (other) throw new HttpError(409, `«${login}» уже в другой семье.`);
    d.prepare('insert into household_members (user_id, household_id) values (?, ?)').run(u.id, hh);
    return { ok: true };
  }

  if (method === 'DELETE' && id === 'members' && action) {
    const u = d.prepare('select id from users where login = ?').get(action.toLowerCase()) as { id: string } | undefined;
    if (!u || householdOf(d, u.id) !== hh) throw new HttpError(404, 'Такого человека в семье нет.');
    d.transaction(() => {
      d.prepare('delete from household_members where user_id = ?').run(u.id);
      const left = d.prepare('select count(*) as n from household_members where household_id = ?').get(hh) as { n: number };
      if (left.n === 0) d.prepare('delete from households where id = ?').run(hh);
    })();
    return { ok: true };
  }

  return undefined;
}
