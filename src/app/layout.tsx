import type { Metadata, Viewport } from 'next';
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
  title: 'Сборы',
  description: 'Чек-листы сборов и напоминания на день',
  // Манифест и значок для экрана «Домой»: на iPhone push-уведомления
  // работают только у сайта, добавленного туда (см. src/lib/pushClient.ts).
  manifest: '/task/manifest.webmanifest',
  icons: {
    icon: [{ url: '/task/icon-192.png', sizes: '192x192', type: 'image/png' }],
    apple: [{ url: '/task/apple-touch-icon.png', sizes: '180x180' }],
  },
  appleWebApp: { capable: true, title: 'Сборы', statusBarStyle: 'default' },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#eef3f2',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ru">
      <body>{children}</body>
    </html>
  );
}
