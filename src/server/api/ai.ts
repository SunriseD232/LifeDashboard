import { CATEGORY_LABELS } from '@/lib/kitchenSeed';
import { match } from '@/lib/kitchen';
import { parseChecklist, parseMenu, parseProducts, parseQuickAdd, parseRecipe, parseTasks, parseText } from '@/lib/aiParse';
import { weekday } from '@/lib/recur';
import { setLabel } from '@/lib/workouts';
import { askJson, aiConfigured, type Part } from '../ai';
import { DAY_RE, HttpError, text, type Ctx } from '../http';
import { readPantry, readProducts, readRecipes, scopeOf } from '../kitchenStore';
import { findNote } from '../noteStore';
import { fetchPageText } from '../pageText';
import { daySummary } from '../summary';
import { readExercises, readWorkouts } from '../workoutStore';

const WEEKDAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MAX_IMAGE = 1_400_000;

function today(v: unknown): string {
  if (typeof v !== 'string' || !DAY_RE.test(v)) throw new HttpError(400, 'Неверная дата.');
  return v;
}

/** Картинка от устройства: data:image/…;base64, не больше MAX_IMAGE. */
function image(v: unknown): Part {
  if (typeof v !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(v) || v.length > MAX_IMAGE) {
    throw new HttpError(400, 'Нужна фотография (JPEG, PNG или WebP) поменьше.');
  }
  return { type: 'image_url', image_url: { url: v } };
}

/** Правило повтора — словами, для подсказки модели (как в src/lib/recur.ts). */
const RULE_DOC = `RULE — одно из:
{"kind":"once","date":"ГГГГ-ММ-ДД"}
{"kind":"repeat","unit":"day|week|month|year","every":N,"start":"ГГГГ-ММ-ДД","weekdays":[дни 0-6, 0=воскресенье] (только для week),"monthly":{"type":"day","day":1-31 или -1 последний} или {"type":"nth","nth":1-5 или -1,"weekday":0-6} (только для month),"end":{"type":"until","date":"ГГГГ-ММ-ДД"} или {"type":"count","count":N} (необязательно)}
{"kind":"after","unit":"day|week|month","every":N,"start":"ГГГГ-ММ-ДД"} — «через N после того, как сделал» (стирка, полив)`;

/**
 * ИИ: /api/ai/<функция>. Всё возвращает ПРЕДЛОЖЕНИЕ — сохраняет человек сам
 * обычными запросами. Ответы модели проверяются (src/lib/aiParse.ts).
 */
export async function ai({ d, userId, method, body, id }: Ctx): Promise<unknown> {
  if (method === 'GET' && id === 'status') return { configured: aiConfigured() };
  if (method !== 'POST') return undefined;
  if (!aiConfigured()) throw new HttpError(503, 'ИИ пока не подключён.');

  switch (id) {
    // ---- фраза → дела, напоминания, заметки, покупки ----
    case 'quick-add': {
      const day = today(body.today);
      const phrase = text(body.text, 1000, 'Фраза')!;
      const raw = await askJson(d, userId, {
        system:
          `Ты разбираешь фразу пользователя приложения LifeDashboard на записи. Сегодня ${day}, ${WEEKDAYS[weekday(day)]}. ` +
          'Типы записей:\n' +
          '- task: дело без точного времени: {"type":"task","title":"…","due_date":"ГГГГ-ММ-ДД" или null,"tag":"короткая метка" или null}\n' +
          '- reminder: есть время суток или повтор: {"type":"reminder","title":"…","times":["ЧЧ:ММ"],"rule":RULE}\n' +
          '- note: просто информация на запомнить: {"type":"note","title":"…","body":"…"}\n' +
          '- shopping: что купить: {"type":"shopping","name":"продукт в именительном падеже","qty":число или null,"unit":"г|кг|мл|л|шт.|упак." или null}\n' +
          `${RULE_DOC}\n` +
          'Правила: start — сегодня, если не сказано иное; «завтра», «в пятницу» переводи в даты; время «вечером» — 19:00, «утром» — 09:00. ' +
          'Названия короткие, как в списке дел. Одна фраза может дать несколько записей (например, напоминание и покупки). ' +
          'Ответ строго JSON: {"items":[…]}',
        user: phrase,
      });
      const items = parseQuickAdd(raw);
      if (!items.length) throw new HttpError(422, 'Не понял, что записать. Скажите иначе, например: «завтра в 9 позвонить врачу».');
      return { items };
    }

    // ---- меню на неделю из своих рецептов и запасов ----
    case 'menu': {
      const days = Math.min(7, Math.max(1, Number(body.days) || 7));
      const prefs = text(body.prefs, 300, 'Пожелания', true);
      const recipes = readRecipes(d, userId);
      if (recipes.length < 3) throw new HttpError(400, 'Нужно хотя бы 3 рецепта — добавьте базовые в «Кухне».');
      const products = readProducts(d);
      const byId = new Map(products.map((p) => [p.id, p]));
      const pantry = new Set(readPantry(d, scopeOf(d, userId)));
      const list = recipes
        .map((r) => {
          const m = match(r, pantry, byId);
          return `${r.id} | ${r.title} | ${CATEGORY_LABELS[r.category]} | ${r.minutes ?? '?'} мин | не хватает: ${m.missing.map((x) => byId.get(x)?.name).join(', ') || 'ничего'}`;
        })
        .join('\n');
      const raw = await askJson(d, userId, {
        system:
          `Составь меню на ${days} дн. из рецептов пользователя. Используй ТОЛЬКО id из списка. Каждый день — 2–3 приёма пищи (завтрак, обед, ужин), ` +
          'чтобы блюда не повторялись подряд, чаще — те, для которых всё есть дома, и чтобы недостающего было поменьше. ' +
          'Ответ строго JSON: {"days":[{"day":"Понедельник","meals":[{"recipe_id":"id","meal":"завтрак|обед|ужин"}]}]}',
        user: `Рецепты (id | название | когда | время | чего не хватает):\n${list}\n\nДома есть: ${[...pantry].map((x) => byId.get(x)?.name).join(', ') || 'ничего не отмечено'}.${prefs ? `\nПожелания: ${prefs}` : ''}`,
        maxTokens: 2500,
      });
      const plan = parseMenu(raw, new Set(recipes.map((r) => r.id)));
      if (!plan.length) throw new HttpError(502, 'Меню не получилось. Попробуйте ещё раз.');
      // Чего не хватает на всё меню — по продуктам, без повторов.
      const used = new Set(plan.flatMap((x) => x.meals.map((m) => m.recipe_id)));
      const missing = [...new Set(recipes.filter((r) => used.has(r.id)).flatMap((r) => match(r, pantry, byId).missing))];
      return { plan, missing };
    }

    // ---- фото чека или холодильника → продукты ----
    case 'pantry-photo': {
      const names = readProducts(d).map((p) => p.name);
      const raw = await askJson(d, userId, {
        system:
          'На фото чек из магазина или содержимое холодильника/полки. Перечисли продукты, которые на нём видны. ' +
          'Названия — простые, в именительном падеже, как в списке покупок; если продукт есть в справочнике — бери название оттуда. ' +
          'Не перечисляй упаковочные пакеты, скидки и итоги чека. Ответ строго JSON: {"products":["…"]}',
        user: [{ type: 'text', text: `Справочник: ${names.join(', ')}` }, image(body.image)],
        maxTokens: 1200,
      });
      const products = parseProducts(raw);
      if (!products.length) throw new HttpError(422, 'На фото не нашёл продуктов. Попробуйте снять ближе и при свете.');
      return { products };
    }

    // ---- рецепт из текста, ссылки или фото ----
    case 'recipe': {
      const names = readProducts(d).map((p) => p.name);
      const parts: Part[] = [{ type: 'text', text: `Справочник продуктов: ${names.join(', ')}` }];
      if (typeof body.url === 'string' && body.url.trim()) parts.push({ type: 'text', text: `Страница рецепта:\n${await fetchPageText(body.url)}` });
      if (typeof body.text === 'string' && body.text.trim()) parts.push({ type: 'text', text: `Текст рецепта:\n${body.text.slice(0, 15000)}` });
      if (body.image) parts.push(image(body.image));
      if (parts.length === 1) throw new HttpError(400, 'Вставьте текст, ссылку или фото рецепта.');
      const raw = await askJson(d, userId, {
        system:
          'Извлеки рецепт. Названия ингредиентов — в именительном падеже, как в справочнике, если такой продукт там есть. ' +
          'Единицы — только: г, кг, мл, л, шт., ст. л., ч. л., стакан, зубчик, ломтик, банка, пучок, упак.; «по вкусу» — qty null. ' +
          'Шаги — короткими предложениями на русском, по порядку. Если рецепт не на русском — переведи. ' +
          'Ответ строго JSON: {"title":"…","category":"breakfast|lunch|dinner|salad|dessert","minutes":число или null,"servings":число,"ingredients":[{"name":"…","qty":число или null,"unit":"…" или null}],"steps":["…"]}',
        user: parts,
        maxTokens: 3000,
      });
      const recipe = parseRecipe(raw);
      if (!recipe) throw new HttpError(422, 'Не нашёл здесь рецепт.');
      return { recipe };
    }

    // ---- сводка дня ----
    case 'summary':
      return { text: await daySummary(d, userId, today(body.today)) };

    // ---- совет по упражнению ----
    case 'workout-advice': {
      const ex = readExercises(d, userId).find((e) => e.id === body.exercise_id);
      if (!ex) throw new HttpError(404, 'Упражнение не найдено.');
      const history = readWorkouts(d, userId)
        .filter((w) => w.exercises.some((e) => e.exercise_id === ex.id))
        .slice(0, 12)
        .reverse()
        .map((w) => `${w.day}: ${w.exercises.filter((e) => e.exercise_id === ex.id).flatMap((e) => e.sets).map(setLabel).join(', ')}`);
      if (!history.length) throw new HttpError(400, 'По этому упражнению ещё нет подходов.');
      const raw = await askJson(d, userId, {
        system:
          'Ты — внимательный тренер. По истории подходов дай совет на следующую тренировку: конкретные веса и повторы, ' +
          'есть ли застой и что с ним делать, на что обратить внимание. 3–5 предложений на русском, без медицинских диагнозов. ' +
          'Ответ строго JSON: {"text":"…"}',
        user: `Упражнение: ${ex.name}\nИстория (старые → новые):\n${history.join('\n')}`,
        maxTokens: 600,
      });
      return { text: parseText(raw) ?? 'Пока нечего посоветовать.' };
    }

    // ---- дела из заметки ----
    case 'note-tasks': {
      const day = today(body.today);
      const note = findNote(d, userId, body.note_id);
      if (!note) throw new HttpError(404, 'Заметка не найдена.');
      const raw = await askJson(d, userId, {
        system:
          `Найди в заметке конкретные дела, которые нужно сделать. Сегодня ${day}. Сроки, если упомянуты, — датой. ` +
          'Названия короткие, как в списке дел, в повелительном наклонении. Не выдумывай. Ответ строго JSON: {"tasks":[{"title":"…","due_date":"ГГГГ-ММ-ДД" или null}]}',
        user: `${note.title}\n\n${note.body}`.slice(0, 12000),
      });
      return { tasks: parseTasks(raw) };
    }

    // ---- чек-лист под поездку ----
    case 'trip-checklist': {
      const where = text(body.where, 100, 'Куда')!;
      const days = Math.min(60, Math.max(1, Number(body.days) || 3));
      const purpose = text(body.purpose, 100, 'Зачем', true) ?? 'отдых';
      const when = typeof body.date === 'string' && DAY_RE.test(body.date) ? body.date : null;
      const raw = await askJson(d, userId, {
        system:
          'Составь чек-лист сборов под эту поездку: учти место, сезон и климат, длительность и цель. Сгруппируй: Документы, Деньги, Одежда, Техника, ' +
          'Гигиена и аптечка, Для цели поездки, Перед выходом. Конкретно и без лишнего, 25–45 пунктов. Название — коротко, например «Сочи, 5 дней». ' +
          'Ответ строго JSON: {"title":"…","items":[{"title":"…","group":"…"}]}',
        user: `Куда: ${where}. На сколько: ${days} дн. Зачем: ${purpose}.${when ? ` Отъезд: ${when}.` : ''}`,
        maxTokens: 2500,
      });
      const list = parseChecklist(raw);
      if (!list) throw new HttpError(502, 'Чек-лист не получился. Попробуйте ещё раз.');
      return list;
    }
  }
  return undefined;
}
