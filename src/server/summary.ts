import type Database from 'better-sqlite3';
import { occurrencesOn } from '@/lib/occurrences';
import { addDays, diffDays, weekday } from '@/lib/recur';
import { bucket } from '@/lib/tasks';
import { plannedFor } from '@/lib/workouts';
import { readChecklists, readItems } from './checklistStore';
import { doneKeys, readReminders } from './reminderStore';
import { readSettings } from './settings';
import { readTasks } from './taskStore';
import { readTemplates } from './workoutStore';
import { askJson } from './ai';
import { parseText } from '@/lib/aiParse';
import { cachedWeather } from './api/weather';

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];

const ICON_WORD: Record<string, string> = { sun: 'ясно', partly: 'переменная облачность', cloud: 'облачно', rain: 'дождь', snow: 'снег', storm: 'гроза', fog: 'туман' };

/**
 * Что в этот день — фактами, без ИИ: из этого модель пишет сводку. day —
 * выбранный день (на Главной можно выбрать в календаре), today — сегодня.
 */
export async function dayFacts(d: Database.Database, userId: string, day: string, today = day): Promise<string> {
  if (day !== today) return otherDayFacts(d, userId, day, today);
  const lines: string[] = [`Сегодня ${day}, ${WEEKDAYS[weekday(day)]}.`];
  const s = readSettings(d, userId);
  const w = s.city ? await cachedWeather(s).catch(() => null) : null;
  if (w) lines.push(`Погода (${w.city}): ${w.now.temp}°, ${w.now.label.toLowerCase()}${w.hint ? `; ${w.hint}` : ''}.`);

  const { tasks } = readTasks(d, userId, day);
  const urgent = tasks.filter((t) => bucket(t, day) === 'urgent');
  const overdue = urgent.filter((t) => t.due_date && t.due_date < day);
  if (urgent.length) lines.push(`Срочные дела (${urgent.length}): ${urgent.slice(0, 8).map((t) => t.title + (t.due_date && t.due_date < day ? ' (просрочено)' : t.due_date === day ? ' (сегодня срок)' : '')).join('; ')}.`);
  if (overdue.length) lines.push(`Просрочено: ${overdue.length}.`);
  const soon = tasks.filter((t) => bucket(t, day) === 'later' && t.due_date! <= addDays(day, 7));
  if (soon.length) lines.push(`Сроки на неделе: ${soon.slice(0, 5).map((t) => `${t.title} — ${t.due_date}`).join('; ')}.`);

  const reminders = readReminders(d, userId);
  const occ = occurrencesOn(reminders, day, new Set(doneKeys(d, userId, day)));
  if (occ.length) {
    const lists = readChecklists(d, userId);
    const items = readItems(d, userId);
    lines.push(
      `Напоминания на сегодня: ${occ
        .map((o) => {
          const c = o.reminder.checklist_id ? lists.find((l) => l.id === o.reminder.checklist_id) : null;
          const its = c ? items.filter((i) => i.checklist_id === c.id) : [];
          return `${o.slot} ${o.reminder.title}${o.done ? ' (сделано)' : ''}${c ? ` (чек-лист «${c.title}» собран ${its.filter((i) => i.done).length} из ${its.length})` : ''}`;
        })
        .join('; ')}.`,
    );
  }
  const plan = plannedFor(readTemplates(d, userId), day);
  if (plan) lines.push(`По плану тренировка: ${plan.title}.`);
  const shop = d
    .prepare("select count(*) as n from checklist_items i join checklists c on c.id = i.checklist_id where c.kind = 'shopping' and i.done = 0 and (c.user_id = ? or c.household_id = (select household_id from household_members where user_id = ?))")
    .get(userId, userId) as { n: number };
  if (shop.n) lines.push(`В списке покупок: ${shop.n}.`);
  return lines.join('\n');
}

/** Другой день (вчера, завтра, через неделю): его сроки, напоминания и прогноз. */
const WEEKDAYS_ACC = ['воскресенье', 'понедельник', 'вторник', 'среду', 'четверг', 'пятницу', 'субботу'];
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];

/** Как назвать день в сводке: «сегодня», «завтра», «вчера» или «в четверг, 15 октября». */
export function dayWord(day: string, today: string): string {
  const n = diffDays(today, day);
  if (n === 0) return 'сегодня';
  if (n === 1) return 'завтра';
  if (n === -1) return 'вчера';
  return `в ${WEEKDAYS_ACC[weekday(day)]}, ${Number(day.slice(8))} ${MONTHS_GEN[Number(day.slice(5, 7)) - 1]}`;
}

/**
 * Страховка: модель иногда пишет «сегодня»/«завтра» про другой день — меняем
 * на правильное название («в четверг, 15 октября»).
 */
export function fixDayWords(text: string, day: string, today: string): string {
  const n = diffDays(today, day);
  const word = dayWord(day, today);
  const swap = (t: string, re: RegExp) =>
    t.replace(re, (m: string, pre: string, first: string) => pre + (first === first.toUpperCase() ? word.charAt(0).toUpperCase() + word.slice(1) : word));
  let out = text;
  if (n !== 0) out = swap(out, /(^|[^А-Яа-яЁё])([Сс])егодня(?![А-Яа-яЁё])/g);
  if (n !== 0 && n !== 1) out = swap(out, /(^|[^А-Яа-яЁё])([Зз])автра(?![А-Яа-яЁё])/g);
  return out;
}

async function otherDayFacts(d: Database.Database, userId: string, day: string, today: string): Promise<string> {
  const n = diffDays(today, day);
  const rel = n > 1 ? `через ${n} дн.` : n < -1 ? `${-n} дн. назад` : dayWord(day, today);
  // Без слова «сегодня» в фактах: модель путала, о каком дне речь.
  const lines: string[] = [`День сводки: ${day}, ${WEEKDAYS[weekday(day)]} (${rel}). Называй его «${dayWord(day, today)}».`];
  const s = readSettings(d, userId);
  const w = s.city && n >= 0 ? await cachedWeather(s).catch(() => null) : null;
  const f = w?.days.find((x) => x.day === day);
  if (f) lines.push(`Прогноз (${w!.city}): от ${f.min}° до ${f.max}°, ${ICON_WORD[f.icon] ?? 'без осадков'}.`);

  const { tasks } = readTasks(d, userId, today);
  const due = tasks.filter((t) => !t.done_at && t.due_date === day);
  if (due.length) lines.push(`Дела со сроком в этот день (${due.length}): ${due.slice(0, 8).map((t) => t.title).join('; ')}.`);
  if (n > 0) {
    const before = tasks.filter((t) => !t.done_at && t.due_date && t.due_date >= today && t.due_date < day);
    if (before.length) lines.push(`До этого дня ещё сроки: ${before.slice(0, 5).map((t) => `${t.title} — ${t.due_date}`).join('; ')}.`);
  }
  const occ = occurrencesOn(readReminders(d, userId), day);
  if (occ.length) lines.push(`Напоминания в этот день: ${occ.map((o) => `${o.slot} ${o.reminder.title}`).join('; ')}.`);
  const plan = plannedFor(readTemplates(d, userId), day);
  if (plan) lines.push(`По плану тренировка: ${plan.title}.`);
  if (lines.length === 1) lines.push('Ничего не запланировано.');
  return lines.join('\n');
}

/** Сводка дня 3–5 предложениями — на главной (на любой выбранный день) и утренним push. */
export async function daySummary(d: Database.Database, userId: string, day: string, today = day): Promise<string> {
  const facts = await dayFacts(d, userId, day, today);
  const word = dayWord(day, today);
  const raw = await askJson(d, userId, {
    system:
      'Ты — помощник в приложении LifeDashboard. По фактам о дне человека напиши короткую сводку на этот день на русском: 3–5 предложений, ' +
      'по делу, дружелюбно, без приветствий и без выдумок — только то, что есть в фактах. Сначала главное (сроки, просроченное, что нужно взять с собой из-за погоды), ' +
      `потом остальное. Если дел нет — так и скажи коротко. О дне сводки говори «${word}»` +
      (word === 'сегодня' ? '.' : word === 'завтра' ? ' — не «сегодня».' : ' — никогда не пиши «сегодня» или «завтра»: это другой день.') +
      ' Ответ строго JSON: {"text":"..."}',
    user: facts,
    maxTokens: 500,
  });
  const text = parseText(raw, 700);
  if (!text) return day === today ? 'Сегодня ничего важного — хорошего дня!' : `${word.charAt(0).toUpperCase() + word.slice(1)} ничего не запланировано.`;
  return fixDayWords(text, day, today);
}
