'use client';

import { useRouter } from 'next/navigation';
import { useEffect } from 'react';

/** Раздела «Календарь» больше нет — календарь теперь в «Задачах». */
export default function CalendarPage() {
  const router = useRouter();
  useEffect(() => router.replace('/tasks'), [router]);
  return null;
}
