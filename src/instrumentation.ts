/**
 * Старт сервера — запускаем рассылку push-напоминаний (src/lib/push.ts).
 *
 * Условие именно такой формы — `if (process.env.NEXT_RUNTIME === 'nodejs')`
 * с импортом внутри: Next собирает этот файл ещё и для edge-рантайма и
 * вырезает ветку только при таком сравнении. С ранним `return` web-push
 * попадал в edge-сборку и падал на отсутствующих там модулях http/net.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    // next build тоже поднимает сервер для пререндера — там таймер не нужен.
    if (process.env.NEXT_PHASE !== 'phase-production-build') {
      const { startScheduler } = await import('./lib/push');
      startScheduler();
    }
  }
}
