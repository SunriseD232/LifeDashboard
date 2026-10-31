// Страница — клиентская, а заголовок вкладки задаётся только на сервере.
export const metadata = { title: 'Напоминания' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
