import { redirect } from 'next/navigation';

/** «Сегодня» теперь на главной супер-аппа; старые ссылки и закладки ведём туда. */
export default function TodayPage() {
  redirect('/');
}
