/**
 * Известные места → категория по умолчанию: для трат из SMS и импорта, когда
 * человек ещё ни разу не ставил категорию этому месту. Его собственный выбор
 * всегда важнее (см. src/server/moneySms.ts). Имена — как в DEFAULT_CATEGORIES.
 */

const RULES: [RegExp, string][] = [
  [/urent|whoosh|юрент|вуш|яндекс\s*go|yandex\s*go|yandex\s*taxi|яндекс\s*такси|uber|убер|ситимобил|citymobil|максим|taxi|такси|metro|метро|мосметро|тройка|troika|ржд|rzd|аэрофлот|aeroflot|победа|pobeda|s7|azs|азс|лукойл|lukoil|газпромнефть|gazpromneft|роснефть|rosneft|shell|tatneft|татнефть|делимобиль|delimobil|belka|белкакар|ситидрайв|citydrive|парковк|parking/i, 'Транспорт'],
  [/пят[её]рочка|pyaterochka|магнит|magnit|перекр[её]сток|perekrestok|ашан|auchan|лента|lenta|дикси|dixy|вкусвилл|vkusvill|азбука вкуса|globus|глобус|окей|o'?key|metro c&c|светофор|самокат|samokat|лавка|lavka|kuper|купер|сбермаркет|sbermarket|бристоль|красное.?белое|krasnoe.?beloe/i, 'Продукты'],
  [/кофе|coffee|cafe|кафе|ресторан|restaurant|бургер|burger|kfc|rostic|ростикс|вкусно\s*(и|—)\s*точка|макдональдс|mcdonald|додо|dodo|шоколадница|starbucks|теремок|якитория|тануки|delivery\s*club|деливери|яндекс\s*еда|yandex\s*eda|кулинари|столов|бизнес.?ланч|пицц|pizza|суши|sushi/i, 'Кафе'],
  [/аптек|apteka|eapteka|36[.,]6|ригла|rigla|горздрав|асна|клиник|clinic|стоматолог|dental|инвитро|invitro|гемотест|медси|medsi/i, 'Здоровье'],
  [/мтс|mts|билайн|beeline|мегафон|megafon|tele2|теле2|ростелеком|rostelecom|йота|yota|дом\.ру|dom\.ru|интернет|internet/i, 'Связь и интернет'],
  [/кинопоиск|kinopoisk|иви|ivi|okko|окко|netflix|spotify|apple\.com|itunes|google\s*play|яндекс\s*плюс|yandex\s*plus|vk\s*музыка|boosty|patreon|chatgpt|openai|anthropic|подписк/i, 'Подписки'],
  [/кино|cinema|синема|театр|theatre|концерт|steam|playstation|xbox|nintendo|боулинг|квест|музей|museum/i, 'Развлечения'],
  [/zara|h&m|uniqlo|lamoda|ламода|wildberries|вайлдберриз|ozon|озон|спортмастер|sportmaster|gloria|глория|befree|ostin|остин|love\s*republic/i, 'Одежда'],
  [/жкх|жку|квартплат|мосэнерго|энергосбыт|водоканал|мосгаз|управляющ|леруа|leroy|obi|икеа|ikea|hoff|хофф/i, 'Дом и ЖКХ'],
  [/комисси|commission|fee\b/i, 'Комиссии'],
];

const norm = (s: string) => s.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim();

/** Название категории по умолчанию для места или null. */
export function merchantCategory(payee: string | null | undefined): string | null {
  if (!payee) return null;
  const p = norm(payee);
  return RULES.find(([re]) => re.test(p))?.[1] ?? null;
}

/** Одно и то же место: без регистра, «ё» = «е», лишние пробелы не важны. */
export function samePayee(a: string | null | undefined, b: string | null | undefined): boolean {
  return !!a && !!b && norm(a) === norm(b);
}

export { norm as normPayee };
