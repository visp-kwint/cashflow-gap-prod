import { Outlet, useLocation } from 'react-router-dom';
import { LogOut } from 'lucide-react';
import { useAuthStore } from '@/store/auth';
import { Button } from '@/components/ui';
import { cn } from '@/lib/cn';
import { BottomNav } from '@/components/layout/BottomNav';

export default function AppLayout() {
  const user = useAuthStore((s) => s.user);
  const logout = useAuthStore((s) => s.logout);
  const { pathname } = useLocation();
  // На календаре футер статичный (в потоке) — запас под fixed-футер не нужен
  const staticFooter = pathname === '/calendar';

  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-30 border-b border-slate-800 bg-slate-900/95 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-3 py-3 sm:px-6">
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-slate-100">Кассовые разрывы</p>
            <p className="truncate text-xs text-slate-400">{user ? user.companyName : 'прогноз по счёту'}</p>
          </div>
          <Button variant="ghost" size="sm" icon={LogOut} onClick={logout}>
            Выйти
          </Button>
        </div>
      </header>

      <main
        className={cn(
          'mx-auto w-full max-w-5xl px-3 py-4 sm:px-6',
          staticFooter ? 'pb-4' : 'pb-24',
        )}
      >
        <Outlet />
      </main>

      <BottomNav />
    </div>
  );
}
