import type Database from 'better-sqlite3';
import { occurrencesOn } from '@/lib/occurrences';
import { addDays, weekday } from '@/lib/recur';
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

/** Что сегодня — фактами, без ИИ: из этого модель пишет сводку. */
export async function dayFacts(d: Database.Database, userId: string, day: string): Promise<string> {
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

/** Сводка дня 3–5 предложениями — на главной и утренним push. */
export async function daySummary(d: Database.Database, userId: string, day: string): Promise<string> {
  const facts = await dayFacts(d, userId, day);
  const raw = await askJson(d, userId, {
    system:
      'Ты — помощник в приложении LifeDashboard. По фактам о дне человека напиши короткую утреннюю сводку на русском: 3–5 предложений, ' +
      'по делу, дружелюбно, без приветствий и без выдумок — только то, что есть в фактах. Сначала главное (сроки, просроченное, что нужно взять с собой из-за погоды), ' +
      'потом остальное. Если дел нет — так и скажи коротко. Ответ строго JSON: {"text":"..."}',
    user: facts,
    maxTokens: 500,
  });
  return parseText(raw, 700) ?? 'Сегодня ничего важного — хорошего дня!';
}
