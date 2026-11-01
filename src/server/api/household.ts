import { randomUUID } from 'node:crypto';
import { notifyUser, loginOf } from '../familyEvents';
import { householdOf, INVITE_DAYS, invitesFor, leaveHousehold, mergeKitchenIn } from '../household';
import { HttpError, text, type Ctx } from '../http';

/** Больше приглашений разом семье не нужно — и перебирать логины так не выйдет. */
const MAX_PENDING = 10;

/**
 * Семья: /api/household[/members[/:login] | /invites/:id].
 *  POST            { name }  — создать (если ещё не в семье);
 *  PATCH           { name }  — переименовать;
 *  POST  members   { login } — пригласить. Ответ один и тот же, есть такой
 *                              человек или нет: логины так не проверить;
 *  DELETE members/:login     — убрать человека; свой логин — выйти;
 *  POST  invites/:id         — принять приглашение (если ещё не в семье);
 *  DELETE invites/:id        — отклонить (приглашённый) или отозвать (семья).
 * Ушёл последний — семья удаляется, общие дела становятся личными у своих
 * авторов, а запасы и холодильник остаются у ушедших (src/server/household.ts).
 */
export function household({ d, userId, method, body, id, action }: Ctx): unknown {
  const hh = householdOf(d, userId);

  if (id === 'invites' && action) {
    const inv = d.prepare('select id, household_id, login, invited_by from household_invites where id = ?').get(action) as
      | { id: string; household_id: string; login: string; invited_by: string }
      | undefined;
    const mine = inv && inv.login === loginOf(d, userId) && invitesFor(d, userId).some((x) => x.id === inv.id);
    const ours = inv && hh && inv.household_id === hh;
    if (!inv || (!mine && !ours)) throw new HttpError(404, 'Приглашение не найдено или устарело.');
    // Ответил на приглашение — неотправленный push о нём уже не нужен.
    const forget = () => {
      const to = d.prepare('select id from users where login = ?').get(inv.login) as { id: string } | undefined;
      if (to) d.prepare("delete from family_events where user_id = ? and kind = 'invite'").run(to.id);
    };
    if (method === 'DELETE') {
      d.prepare('delete from household_invites where id = ?').run(inv.id);
      forget();
      return { ok: true };
    }
    if (method === 'POST' && mine) {
      if (hh) throw new HttpError(409, 'Вы уже в семье. Сначала выйдите из неё в настройках.');
      d.transaction(() => {
        d.prepare('insert into household_members (user_id, household_id) values (?, ?)').run(userId, inv.household_id);
        d.prepare('delete from household_invites where id = ?').run(inv.id);
        mergeKitchenIn(d, userId, inv.household_id);
        forget();
      })();
      return { ok: true };
    }
    return undefined;
  }

  if (method === 'POST' && !id) {
    if (hh) throw new HttpError(409, 'Вы уже в семье.');
    const hid = randomUUID();
    d.transaction(() => {
      d.prepare('insert into households (id, name, created_by) values (?, ?, ?)').run(hid, text(body.name, 60, 'Название'), userId);
      d.prepare('insert into household_members (user_id, household_id) values (?, ?)').run(userId, hid);
      mergeKitchenIn(d, userId, hid);
    })();
    return { id: hid };
  }

  if (!hh) throw new HttpError(404, 'Вы не в семье.');

  if (method === 'PATCH' && !id) {
    d.prepare('update households set name = ? where id = ?').run(text(body.name, 60, 'Название'), hh);
    return { ok: true };
  }

  if (method === 'POST' && id === 'members' && !action) {
    const login = text(body.login, 64, 'Логин')!.trim().toLowerCase();
    // Уже в этой семье — ничего не делаем, но и не говорим об этом иначе.
    const member = d.prepare('select 1 from household_members m join users u on u.id = m.user_id where m.household_id = ? and u.login = ?').get(hh, login);
    if (!member) {
      d.prepare(`delete from household_invites where household_id = ? and created_at < datetime('now', '-${INVITE_DAYS} day')`).run(hh);
      const pending = d.prepare('select count(*) as n from household_invites where household_id = ?').get(hh) as { n: number };
      const again = d.prepare('select 1 from household_invites where household_id = ? and login = ?').get(hh, login);
      if (!again && pending.n >= MAX_PENDING) throw new HttpError(429, `Не больше ${MAX_PENDING} приглашений сразу — отзовите ненужные.`);
      d.prepare(
        `insert into household_invites (id, household_id, login, invited_by) values (?, ?, ?, ?)
         on conflict (household_id, login) do update set created_at = datetime('now'), invited_by = excluded.invited_by`,
      ).run(randomUUID(), hh, login, userId);
      const to = d.prepare('select id from users where login = ?').get(login) as { id: string } | undefined;
      const family = (d.prepare('select name from households where id = ?').get(hh) as { name: string }).name;
      if (to) notifyUser(d, to.id, 'invite', `${loginOf(d, userId)} зовёт вас в семью «${family}»`, '/task/settings#set-family');
    }
    return { ok: true };
  }

  if (method === 'DELETE' && id === 'members' && action) {
    const u = d.prepare('select id from users where login = ?').get(action.toLowerCase()) as { id: string } | undefined;
    if (!u || householdOf(d, u.id) !== hh) throw new HttpError(404, 'Такого человека в семье нет.');
    d.transaction(() => leaveHousehold(d, u.id, hh))();
    return { ok: true };
  }

  return undefined;
}
