import type { Metadata } from 'next';
import MoneyShell from '@/components/money/MoneyShell';
import './money.css';

// Своё приложение для экрана «Домой»: отдельный манифест с областью /task/money,
// поэтому на iPhone «Деньги» — отдельная иконка, а не вкладка LifeDashboard.
// Свой значок: белый кошелёк на глубокой бирюзе (public/money/).
export const metadata: Metadata = {
  title: 'Деньги',
  description: 'Траты, счета и валюты',
  manifest: '/task/money/manifest.webmanifest',
  icons: { icon: '/task/money/favicon-32.png', apple: '/task/money/apple-touch-icon.png' },
  appleWebApp: { capable: true, title: 'Деньги', statusBarStyle: 'default' },
};

export default function MoneyLayout({ children }: { children: React.ReactNode }) {
  return <MoneyShell>{children}</MoneyShell>;
}
