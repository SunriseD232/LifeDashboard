'use client';

/**
 * Вместо «Application error» Next.js — понятный экран (src/app/error.tsx,
 * src/app/global-error.tsx). Чаще всего это не баг, а связь: через VPN
 * сервер не отвечает, и не догрузился кусок кода раздела. Тогда — что
 * сделать; иначе — текст ошибки, чтобы прислать в поддержку.
 */

const NETWORK = /ChunkLoadError|Loading chunk|Loading CSS chunk|Failed to fetch|NetworkError|Load failed/i;

/** Сохранённые страницы и сервис-воркер — долой: следующая загрузка целиком с сервера. */
async function resetCache() {
  try {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('ld-')).map((k) => caches.delete(k)));
    const regs = await navigator.serviceWorker?.getRegistrations();
    await Promise.all((regs ?? []).map((r) => r.unregister()));
  } catch {
    /* нет доступа — просто перезагрузим */
  }
  location.reload();
}

export default function Crash({ error }: { error: Error & { digest?: string } }) {
  const net = NETWORK.test(`${error.name} ${error.message}`) || (typeof navigator !== 'undefined' && !navigator.onLine);
  const box = { maxWidth: 440, padding: 24, display: 'flex', flexDirection: 'column', gap: 12 } as const;
  return (
    <main style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 16, background: 'var(--ground, #0e1615)', color: 'var(--ink, #e6efed)', fontFamily: 'system-ui, sans-serif' }}>
      <div style={box} role="alert">
        <h1 style={{ margin: 0, fontSize: 24 }}>{net ? 'Нет связи с сервером' : 'Что-то сломалось'}</h1>
        <p style={{ margin: 0, opacity: 0.8 }}>
          {net
            ? 'Этот раздел не догрузился. Если включён VPN — добавьте media-watch.ru в исключения (сайт российский, VPN ему не нужен) или смените страну, и попробуйте ещё раз.'
            : 'Попробуйте ещё раз. Не помогло — сбросьте сохранённые страницы, а если и это не поможет, пришлите текст ниже в поддержку.'}
        </p>
        <button type="button" onClick={() => location.reload()} style={{ minHeight: 44, borderRadius: 12, border: 0, background: '#0e7c7b', color: '#fff', fontSize: 16, cursor: 'pointer' }}>
          Попробовать ещё раз
        </button>
        <button type="button" onClick={resetCache} style={{ minHeight: 44, borderRadius: 12, border: '1px solid currentColor', background: 'none', color: 'inherit', fontSize: 15, cursor: 'pointer' }}>
          Сбросить сохранённые страницы
        </button>
        <code style={{ fontSize: 12, opacity: 0.6, overflowWrap: 'anywhere' }}>
          {error.name}: {error.message}
          {error.digest ? ` (${error.digest})` : ''}
        </code>
      </div>
    </main>
  );
}
