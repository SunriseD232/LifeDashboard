import type { Metadata } from 'next';
import MoneyShell from '@/components/money/MoneyShell';
import './money.css';

// Своё приложение для экрана «Домой»: отдельный манифест с областью /task/money,
// поэтому на iPhone «Деньги» — отдельная иконка, а не вкладка LifeDashboard.
// Значки пока общие с LifeDashboard.
export const metadata: Metadata = {
  title: 'Деньги',
  description: 'Траты, счета и валюты',
  manifest: '/task/money/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'Деньги', statusBarStyle: 'default' },
};

export default function MoneyLayout({ children }: { children: React.ReactNode }) {
  return <MoneyShell>{children}</MoneyShell>;
}
