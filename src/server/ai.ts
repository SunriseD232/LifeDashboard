import type Database from 'better-sqlite3';
import { ProxyAgent } from 'undici';
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
const TIMEOUT_MS = 60_000;
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

async function openRouter(req: AiRequest): Promise<string> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new HttpError(503, 'ИИ пока не подключён.');
  const proxy = process.env.AI_PROXY_URL;
  if (proxy && !agent) agent = new ProxyAgent(proxy);
  let res: Response;
  try {
    res = await fetch(URL_, {
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
        max_tokens: req.maxTokens ?? 2000,
        temperature: 0.3,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      // Через прокси — dispatcher из undici; с телом запроса нужен duplex,
      // иначе fetch повисает (проверено в MediaWatch).
      ...(agent ? { dispatcher: agent, duplex: 'half' } : {}),
    } as RequestInit);
  } catch (e) {
    console.error('[lifedashboard ai] сеть:', (e as Error).message);
    throw new HttpError(502, 'ИИ не ответил. Попробуйте ещё раз.');
  }
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    console.error(`[lifedashboard ai] HTTP ${res.status}: ${body.slice(0, 300)}`);
    throw new HttpError(res.status === 401 || res.status === 402 ? 503 : 502, res.status === 401 ? 'ИИ не подключён: ключ OpenRouter не принят.' : res.status === 402 ? 'ИИ: на счёте OpenRouter закончились деньги.' : 'ИИ не ответил. Попробуйте ещё раз.');
  }
  const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
  const content = data.choices?.[0]?.message?.content;
  if (!content) throw new HttpError(502, 'ИИ ответил пусто. Попробуйте ещё раз.');
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
