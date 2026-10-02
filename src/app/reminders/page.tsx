'use client';

import { useRouter } from 'next/navigation';
import { useApp } from '@/components/AppShell';
import Reminders from '@/components/Reminders';

export default function RemindersPage() {
  const { data, mutate, reload, now, setOpenList, toast } = useApp();
  const router = useRouter();
  return (
    <Reminders
      data={data}
      mutate={mutate}
      reload={reload}
      now={now}
      toast={toast}
      onOpenChecklist={(id) => {
        setOpenList(id);
        router.push('/lists');
      }}
    />
  );
}
