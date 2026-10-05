import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import AppShell from '@/components/AppShell';
import { ACCENT_COOKIE, BG_COOKIE, isAccent, isBg, isSize, SIZE_COOKIE, THEME_COOKIE, THEMES, type Theme } from '@/lib/theme';
// Шрифты — те же, что на макете в Claude Design, из пакетов @fontsource:
// файлы лежат в сборке и отдаются с нашего сервера, без внешних запросов.
// Каждый пакет подключает и латиницу, и кириллицу (unicode-range — браузер
// скачает только нужное).
import '@fontsource/onest/600.css';
import '@fontsource/onest/700.css';
import '@fontsource/onest/800.css';
import '@fontsource/golos-text/400.css';
import '@fontsource/golos-text/500.css';
import '@fontsource/golos-text/600.css';
import '@fontsource/jetbrains-mono/500.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'LifeDashboard',
  description: 'Дела, чек-листы и напоминания на каждый день',
  // Манифест и значок для экрана «Домой»: на iPhone push-уведомления
  // работают только у сайта, добавленного туда (см. src/lib/pushClient.ts).
  manifest: '/task/manifest.webmanifest',
  icons: {
    icon: [{ url: '/task/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/task/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: { capable: true, title: 'LifeDashboard', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // iPhone (особенно с экрана «Домой») после поворота оставался приближенным.
  // Свой зум пальцами iOS всё равно разрешает — это его правило доступности.
  maximumScale: 1,
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef3f2' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1615' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // Тема из куки — сразу в разметку, чтобы тёмная не мигала светлой.
  const saved = cookies().get(THEME_COOKIE)?.value as Theme | undefined;
  const theme = saved && THEMES.includes(saved) ? saved : 'system';
  // Акцент и размер текста — тоже из кук, по умолчанию атрибутов нет.
  const accent = cookies().get(ACCENT_COOKIE)?.value;
  const size = cookies().get(SIZE_COOKIE)?.value;
  const bg = cookies().get(BG_COOKIE)?.value;
  return (
    <html lang="ru" data-theme={theme} data-accent={isAccent(accent) && accent !== 'teal' ? accent : undefined} data-size={isSize(size) && size !== 'md' ? size : undefined} data-bg={isBg(bg) && bg !== 'cool' ? bg : undefined}>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
