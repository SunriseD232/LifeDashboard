import { matches, words } from './search';

/**
 * Быстрые действия в поиске (Ctrl K): набрал «трата», «настройки», «отпуск» —
 * первым пунктом переход или действие. Пустой ввод — самые частые.
 */
export interface QuickAction {
  id: string;
  label: string;
  /** Другие слова, по которым находить. */
  also: string;
  icon: string;
  href: string;
  /** Только когда «Деньги» открыты человеку. */
  money?: boolean;
  /** Показывать, пока ничего не введено. */
  top?: boolean;
}

export const QUICK_ACTIONS: QuickAction[] = [
  { id: 'new-task', label: 'Новая задача', also: 'добавить дело напоминание создать', icon: 'plus', href: '/tasks?new=1', top: true },
  { id: 'new-op', label: 'Записать трату', also: 'трата траты расход операция покупка добавить деньги', icon: 'wallet', href: '/money?new=op', money: true, top: true },
  { id: 'vacation', label: 'Отпуска', also: 'отпуск каникулы выходные календарь', icon: 'suitcase', href: '/vacations', top: true },
  { id: 'review', label: 'Итог дня', also: 'перенести несделанное просрочено завтра', icon: 'calendar', href: '/review' },
  { id: 'tasks', label: 'Задачи', also: 'дела список календарь', icon: 'tasks', href: '/tasks' },
  { id: 'notes', label: 'Заметки', also: 'записи текст', icon: 'note', href: '/notes' },
  { id: 'lists', label: 'Чек-листы', also: 'списки покупки', icon: 'list', href: '/lists' },
  { id: 'kitchen', label: 'Кухня', also: 'рецепты продукты еда', icon: 'pot', href: '/kitchen' },
  { id: 'new-recipe', label: 'Новый рецепт', also: 'добавить блюдо кухня', icon: 'plus', href: '/kitchen/new' },
  { id: 'workouts', label: 'Тренировки', also: 'спорт зал упражнения', icon: 'dumbbell', href: '/workouts' },
  { id: 'money', label: 'Деньги', also: 'обзор финансы бюджет', icon: 'wallet', href: '/money', money: true },
  { id: 'money-ops', label: 'Операции', also: 'траты доходы деньги история', icon: 'list', href: '/money/ops', money: true },
  { id: 'money-report', label: 'Отчёты по деньгам', also: 'отчёт статистика траты категории', icon: 'chart', href: '/money/report', money: true },
  { id: 'money-accounts', label: 'Счета', also: 'карты остатки баланс деньги', icon: 'receipt', href: '/money/accounts', money: true },
  { id: 'money-debts', label: 'Долги', also: 'должен занял деньги', icon: 'users', href: '/money/debts', money: true },
  { id: 'money-goals', label: 'Цели', also: 'накопления копилка деньги', icon: 'flag', href: '/money/goals', money: true },
  { id: 'money-settings', label: 'Настройки денег', also: 'валюты категории деньги', icon: 'settings', href: '/money/settings', money: true },
  { id: 'settings', label: 'Настройки', also: 'параметры', icon: 'settings', href: '/settings', top: true },
  { id: 'push', label: 'Уведомления', also: 'push пуш настройки', icon: 'bell', href: '/settings#set-push' },
  { id: 'holidays', label: 'Праздники', also: 'выходные страна производственный календарь переносы настройки', icon: 'sun', href: '/settings#set-holidays' },
  { id: 'rhythm', label: 'Ритм дня', also: 'тихие часы время по умолчанию сводка итог настройки', icon: 'clock', href: '/settings#set-rhythm' },
  { id: 'theme', label: 'Оформление', also: 'тема тёмная светлая цвет шрифт размер текста настройки', icon: 'moon', href: '/settings#set-theme' },
  { id: 'family', label: 'Семья', also: 'общие близкие настройки', icon: 'users', href: '/settings#set-family' },
  { id: 'hub', label: 'Настроить главную', also: 'плитки быстрые действия нижнее меню', icon: 'home', href: '/settings/home' },
  { id: 'menu', label: 'Разделы меню', also: 'порядок скрыть меню настройки', icon: 'list', href: '/settings/menu' },
  { id: 'guide', label: 'Как пользоваться', also: 'помощь справка инструкция', icon: 'help', href: '/guide' },
  { id: 'support', label: 'Написать в поддержку', also: 'помощь вопрос ошибка', icon: 'chat', href: '/support' },
];

/** Что показать: по вводу — подходящие (не больше max), пусто — частые. */
export function quickActions(input: string, withMoney: boolean, max = 5): QuickAction[] {
  const list = QUICK_ACTIONS.filter((a) => withMoney || !a.money);
  const q = words(input);
  if (!q.length) return list.filter((a) => a.top);
  // Сначала — где совпало название, потом — по другим словам.
  const byLabel = list.filter((a) => matches(a.label, q));
  const byAlso = list.filter((a) => !byLabel.includes(a) && matches(`${a.label} ${a.also}`, q));
  return [...byLabel, ...byAlso].slice(0, max);
}
