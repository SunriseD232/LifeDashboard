import HubSettings from '@/components/HubSettings';
import SubPage from '@/components/SubPage';

export const metadata = { title: 'Настроить главную' };

export default function HubSettingsPage() {
  return (
    <SubPage title="Настроить главную" back="/" backLabel="Главная">
      <HubSettings />
    </SubPage>
  );
}
