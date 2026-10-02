import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { HttpError } from './http';

/**
 * Текст страницы по ссылке — для «рецепт по ссылке». Ссылку присылает
 * пользователь, а ходит сервер, поэтому защищаемся от запросов во внутреннюю
 * сеть: только http(s), только публичные адреса (проверяем каждый переход
 * по редиректу), не больше MAX_BYTES и TIMEOUT_MS.
 */

const MAX_BYTES = 1_500_000;
const TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;

/** Внутренние, служебные и зарезервированные адреса. */
export function isPrivateIp(ip: string): boolean {
  if (isIP(ip) === 4) {
    const [a, b] = ip.split('.').map(Number);
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const v = ip.toLowerCase();
  if (v.startsWith('::ffff:')) return isPrivateIp(v.slice(7));
  return v === '::' || v === '::1' || v.startsWith('fc') || v.startsWith('fd') || v.startsWith('fe8') || v.startsWith('fe9') || v.startsWith('fea') || v.startsWith('feb');
}

async function assertPublic(u: URL): Promise<void> {
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new HttpError(400, 'Нужна ссылка http(s).');
  if (u.port && u.port !== '80' && u.port !== '443') throw new HttpError(400, 'Такая ссылка не подходит.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  const addrs = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => [])).map((a) => a.address);
  if (!addrs.length) throw new HttpError(400, 'Сайт не найден.');
  if (addrs.some(isPrivateIp)) throw new HttpError(400, 'Такая ссылка не подходит.');
}

/** HTML → текст: без скриптов, стилей и тегов, с базовыми сущностями. */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|nav|footer|header)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|li|h\d|div|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Разметка рецепта schema.org (JSON-LD), если сайт её даёт, — она точнее текста. */
export function recipeJsonLd(html: string): string | null {
  for (const m of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    if (/"@type"\s*:\s*(\[[^\]]*)?"Recipe"/.test(m[1])) return m[1].trim().slice(0, 20_000);
  }
  return null;
}

export async function fetchPageText(raw: string): Promise<string> {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new HttpError(400, 'Это не похоже на ссылку.');
  }
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    await assertPublic(u);
    let res: Response;
    try {
      res = await fetch(u, { redirect: 'manual', signal: AbortSignal.timeout(TIMEOUT_MS), headers: { 'User-Agent': 'Mozilla/5.0 LifeDashboard' } });
    } catch {
      throw new HttpError(502, 'Сайт не ответил.');
    }
    if (res.status >= 300 && res.status < 400 && res.headers.get('location')) {
      u = new URL(res.headers.get('location')!, u);
      continue;
    }
    if (!res.ok) throw new HttpError(502, `Сайт ответил ошибкой ${res.status}.`);
    const reader = res.body?.getReader();
    if (!reader) throw new HttpError(502, 'Пустая страница.');
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > MAX_BYTES) {
        await reader.cancel();
        break;
      }
      chunks.push(value);
    }
    const html = new TextDecoder().decode(Buffer.concat(chunks));
    return recipeJsonLd(html) ?? htmlToText(html).slice(0, 15_000);
  }
  throw new HttpError(400, 'Слишком много переадресаций.');
}
