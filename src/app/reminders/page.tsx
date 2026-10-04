'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect } from 'react';

/**
 * «Напоминания» теперь внутри «Дел». Старые адреса (в том числе из уже
 * присланных push: ?focus=…, из поиска: ?edit=…) ведут туда же.
 */
export default function RemindersPage() {
  const router = useRouter();
  const params = useSearchParams();
  useEffect(() => {
    const q = params.toString();
    router.replace(q ? `/tasks?${q}` : '/tasks');
  }, [router, params]);
  return null;
}
