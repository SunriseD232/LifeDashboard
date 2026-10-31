// Страница — клиентская, а заголовок вкладки задаётся только на сервере.
export const metadata = { title: 'Календарь' };

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
