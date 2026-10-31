import { NavEditor } from '@/components/SettingsExtra';
import SubPage from '@/components/SubPage';

export const metadata = { title: 'Разделы меню' };

export default function MenuSettingsPage() {
  return (
    <SubPage title="Разделы меню" back="/settings" backLabel="Настройки">
      <NavEditor />
    </SubPage>
  );
}
