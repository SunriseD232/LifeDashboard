import type { Metadata, Viewport } from 'next';
import AppShell from '@/components/AppShell';
import { ACCENT_COOKIE, ACCENTS, BG_COOKIE, BGS, SIZE_COOKIE, SIZES, THEME_COOKIE, THEMES } from '@/lib/theme';
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
  // У каждого раздела своё название вкладки: по нему диктор объявляет переход.
  title: { default: 'LifeDashboard', template: '%s · LifeDashboard' },
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
  // maximumScale не ставим: Android тогда запрещает зум пальцами. Залипший
  // после поворота зум на iPhone лечат text-size-adjust и overflow-x: clip.
  viewportFit: 'cover',
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#eef3f2' },
    { media: '(prefers-color-scheme: dark)', color: '#0e1615' },
  ],
};

/**
 * Оформление из кук — на <html> до первой отрисовки, чтобы тёмная тема не
 * мигала светлой. Раньше куки читал сервер (cookies()), но тогда КАЖДАЯ
 * страница становилась динамической: переход по меню ждал ответа сервера, а
 * не открывался сразу из предзагрузки. Скрипт в <head> делает то же самое в
 * браузере, и страницы остаются статическими.
 */
const ATTRS: [string, string, readonly string[], string][] = [
  ['theme', THEME_COOKIE, THEMES, ''],
  ['accent', ACCENT_COOKIE, ACCENTS.map((a) => a.id), 'teal'],
  ['size', SIZE_COOKIE, SIZES.map((x) => x.id), 'md'],
  ['bg', BG_COOKIE, BGS.map((b) => b.id), 'cool'],
];
const LOOKS = `(function(){try{var c=document.cookie,h=document.documentElement;${JSON.stringify(ATTRS)}.forEach(function(a){var m=c.match(new RegExp('(?:^|; )'+a[1]+'=([^;]*)'));if(m&&a[2].indexOf(m[1])>=0&&m[1]!==a[3])h.setAttribute('data-'+a[0],m[1])})}catch(e){}})()`;

export default function RootLayout({ children }: { children: React.ReactNode }) {
  // data-theme="system" по умолчанию; скрипт заменит его выбранной темой.
  // suppressHydrationWarning — атрибуты <html> меняет скрипт до React.
  return (
    <html lang="ru" data-theme="system" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: LOOKS }} />
      </head>
      <body>
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
