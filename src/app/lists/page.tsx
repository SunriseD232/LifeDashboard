'use client';

import { useApp } from '@/components/AppShell';
import Checklists from '@/components/Checklists';

export default function ListsPage() {
  const { data, mutate, reload, openList, setOpenList, toast } = useApp();
  return <Checklists data={data} mutate={mutate} reload={reload} openId={openList} setOpenId={setOpenList} toast={toast} />;
}
