import type Database from 'better-sqlite3';
import { fetch as undiciFetch, ProxyAgent } from 'undici';
import { parseJsonLoose } from '@/lib/aiParse';
import { HttpError } from './http';

/**
 * ИИ через OpenRouter. Настройки — в /opt/lifedashboard/.env:
 *   OPENROUTER_API_KEY=…            ключ (тот же, что у MediaWatch, — копия)
 *   AI_MODEL=z-ai/glm-5.3-flash     модель; понимает и текст, и картинки
 *   AI_PROXY_URL=http://127.0.0.1:10809
 *       openrouter.ai с этой VPS режется WAF — ходим через локальный туннель
 *       (Xray на сервере, общий для всего VPS). На другом сервере — убрать.
 *   AI_DAILY_LIMIT=50               запросов на человека в сутки
 *
 * Модель отвечает строго JSON; дальше ответ разбирают и проверяют функции из
 * src/lib/aiParse.ts — сохраняет человек сам, после просмотра.
 */

const URL_ = 'https://openrouter.ai/api/v1/chat/completions';
// Меньше, чем ждёт nginx (proxy_read_timeout 90s): лучше понятная ошибка,
// чем «504 Gateway Timeout».
const TIMEOUT_MS = 75_000;
const DEFAULT_MODEL = 'z-ai/glm-5.3-flash';

export type Part = { type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string } };

export interface AiRequest {
  system: string;
  user: string | Part[];
  maxTokens?: number;
}

/** Транспорт — подменяется в тестах; по умолчанию — fetch к OpenRouter. */
type Transport = (req: AiRequest) => Promise<string>;
let transport: Transport | null = null;
export function setAiTransport(t: Transport | null): void {
  transport = t;
}

let agent: ProxyAgent | null = null;

/**
 * Модель сначала «думает» (reasoning) и тратит на это токены из того же
 * max_tokens — сотни на простой вопрос. Без запаса короткие ответы (сводка,
 * совет) обрезались бы до пустого. Платим только за потраченное.
 */
const REASONING_ALLOWANCE = 3000;

async function openRouter(req: AiRequest): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new HttpError(503, 'ИИ пока не подключён.');
  const proxy = process.env.AI_PROXY_URL;
  if (proxy && !agent) agent = new ProxyAgent(proxy);
  // Срок — на весь ответ целиком: OpenRouter шлёт заголовки сразу, а тело —
  // когда модель допишет, и таймаут только на соединение тут не спасает.
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    return await call(req, key, ctl.signal);
  } catch (e) {
    if (ctl.signal.aborted) {
      console.error('[lifedashboard ai] не уложился в', TIMEOUT_MS / 1000, 'с');
      throw new HttpError(504, 'ИИ думает слишком долго. Попробуйте ещё раз или короче.');
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

async function call(req: AiRequest, key: string, signal: AbortSignal): Promise<string> {
  let res: Awaited<ReturnType<typeof undiciFetch>>;
  try {
    // fetch из undici, а не встроенный в Next: он честно слушает и прокси
    // (dispatcher), и отмену (signal).
    res = await undiciFetch(URL_, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://media-watch.ru/task',
        'X-Title': 'LifeDashboard',
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || DEFAULT_MODEL,
        messages: [
          { role: 'system', content: req.system },
          { role: 'user', content: req.user },
        ],
        response_format: { type: 'json_object' },
        // Модель по умолчанию долго «думает» (тысячи токенов, больше минуты);
        // нашим задачам хватает короткого размышления — в 3 раза быстрее.
        reasoning: { effort: 'low' },
        max_tokens: (req.maxTokens ?? 2000) + REASONING_ALLOWANCE,
        temperature: 0.3,
      }),
      signal,
      ...(agent ? { dispatcher: agent } : {}),
    });
  } catch (e) {
    if (signal.aborted) throw e;
    console.error('[lifedashboard ai] сеть:', (e as Error).message);
    throw new HttpError(502, 'ИИ не ответил. Попробуйте ещё раз.');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[lifedashboard ai] HTTP ${res.status}: ${body.slice(0, 300)}`);
    throw new HttpError(res.status === 401 || res.status === 402 ? 503 : 502, res.status === 401 ? 'ИИ не подключён: ключ OpenRouter не принят.' : res.status === 402 ? 'ИИ: на счёте OpenRouter закончились деньги.' : 'ИИ не ответил. Попробуйте ещё раз.');
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string }; finish_reason?: string }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    console.error('[lifedashboard ai] пустой ответ, finish_reason:', data.choices?.[0]?.finish_reason);
    throw new HttpError(502, 'ИИ ответил пусто. Попробуйте ещё раз.');
  }
  return content;
}

export function aiConfigured(): boolean {
  return !!transport || !!process.env.OPENROUTER_API_KEY;
}

const limit = () => Number(process.env.AI_DAILY_LIMIT) || 50;

/** Учёт запросов: больше лимита в сутки — отказ. День — по UTC, этого хватает. */
function spend(d: Database.Database, userId: string): void {
  const day = new Date().toISOString().slice(0, 10);
  const row = d.prepare('select count from ai_usage where user_id = ? and day = ?').get(userId, day) as { count: number } | undefined;
  if ((row?.count ?? 0) >= limit()) throw new HttpError(429, `На сегодня запросы к ИИ закончились (${limit()} в сутки). Завтра снова можно.`);
  d.prepare('insert into ai_usage (user_id, day, count) values (?, ?, 1) on conflict (user_id, day) do update set count = count + 1').run(userId, day);
}

/** Запрос к модели → разобранный JSON (проверка — на вызывающем). */
export async function askJson(d: Database.Database, userId: string, req: AiRequest): Promise<unknown> {
  spend(d, userId);
  const text = await (transport ?? openRouter)(req);
  try {
    return parseJsonLoose(text);
  } catch {
    console.error('[lifedashboard ai] не JSON:', text.slice(0, 300));
    throw new HttpError(502, 'ИИ ответил непонятно. Попробуйте ещё раз.');
  }
}
