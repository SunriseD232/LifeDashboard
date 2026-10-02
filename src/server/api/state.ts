import { userLogin } from '@/lib/auth';
import { readChecklists, readItems } from '../checklistStore';
import { householdInfo } from '../household';
import { readPantry, readProducts, readRecipes, scopeOf, shoppingList } from '../kitchenStore';
import { readNotes } from '../noteStore';
import { readExercises, readTemplates, readWorkouts } from '../workoutStore';
import { doneKeys, readReminders, snoozesOn } from '../reminderStore';
import { readSettings } from '../settings';
import { readTasks } from '../taskStore';
import { DAY_RE, HttpError, type Ctx } from '../http';

/** Всё сразу: экран открывается одним запросом (GET /api/state?day=). */
export function state({ d, userId, method, req }: Ctx): unknown {
  if (method === 'GET') {
    const day = req.nextUrl.searchParams.get('day') ?? '';
    if (!DAY_RE.test(day)) throw new HttpError(400, 'Неверная дата.');
    const checklists = readChecklists(d, userId);
    const items = readItems(d, userId);
    // Без названия чек-листа — экрану оно приходит из самих чек-листов.
    const reminders = readReminders(d, userId).map(({ checklist_title: _, ...r }) => r);
    const done = doneKeys(d, userId, day);
    const snoozed = snoozesOn(d, userId, day);
    const { tasks, doneToday } = readTasks(d, userId, day);
    return {
      checklists,
      items,
      reminders,
      done,
      snoozed,
      tasks,
      tasksDoneToday: doneToday,
      notes: readNotes(d, userId),
      kitchen: {
        products: readProducts(d),
        recipes: readRecipes(d, userId),
        pantry: readPantry(d, scopeOf(d, userId)),
        shopping_id: shoppingList(d, userId, false)?.id ?? null,
      },
      gym: {
        workouts: readWorkouts(d, userId),
        exercises: readExercises(d, userId),
        templates: readTemplates(d, userId),
      },
      settings: readSettings(d, userId),
      household: householdInfo(d, userId),
      login: userLogin(userId),
    };
  }
  return undefined;
}
