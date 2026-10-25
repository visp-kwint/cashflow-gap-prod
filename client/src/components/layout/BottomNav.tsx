import { useEffect, useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { CreditCard, History, Home, LifeBuoy } from 'lucide-react';
import { cn } from '@/lib/cn';

const ITEMS = [
  { to: '/', label: 'Главная', icon: Home, end: true },
  { to: '/payments', label: 'Оплата', icon: CreditCard },
  { to: '/history', label: 'История', icon: History },
  { to: '/support', label: 'Поддержка', icon: LifeBuoy },
];

// Календарь — короткая страница: выездной футер на ней багается
// (прячется/выезжает на каждом мелком скролле). Там футер рендерим статичным.
export function BottomNav() {
  const { pathname } = useLocation();
  const staticMode = pathname === '/calendar';
  // Футер выезжает при любом небольшом скролле вниз и прячется в самом верху страницы
  const [shown, setShown] = useState(true);
  useEffect(() => {
    if (staticMode) return;
    function onScroll() {
      setShown(window.scrollY > 16);
    }
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [staticMode]);

  return (
    <nav
      className={cn(
        'z-40 border-t border-slate-800 bg-slate-900/95 pb-safe backdrop-blur',
        staticMode ? 'relative' : 'fixed inset-x-0 bottom-0',
        !staticMode && (shown ? 'nav-footer-shown' : 'nav-footer-hidden'),
      )}
    >
      <div className="mx-auto grid max-w-5xl grid-cols-4">
        {ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              cn(
                'flex flex-col items-center gap-1 py-2.5 text-xs font-medium transition-colors',
                isActive ? 'text-emerald-400' : 'text-slate-500 hover:text-slate-300',
              )
            }
          >
            {({ isActive }) => (
              <>
                <span
                  className={cn(
                    'grid h-8 w-8 place-items-center rounded-lg transition-colors',
                    isActive ? 'bg-emerald-500 text-slate-950' : 'bg-slate-800 text-slate-400',
                  )}
                >
                  <item.icon size={16} />
                </span>
                {item.label}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}
