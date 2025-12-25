import { Scale, ShoppingBag, User } from 'lucide-react';
import { useEffect, useState } from 'react';

export default function BottomNav() {
  const [currentPath, setCurrentPath] = useState('/');

  useEffect(() => {
    // Get current path on mount and update on navigation
    const updatePath = () => {
      setCurrentPath(window.location.pathname);
    };

    updatePath();

    // Listen for navigation changes
    window.addEventListener('popstate', updatePath);

    // Also listen for custom route changes (SPA-like navigation)
    window.addEventListener('astro:page-load', updatePath);

    return () => {
      window.removeEventListener('popstate', updatePath);
      window.removeEventListener('astro:page-load', updatePath);
    };
  }, []);

  const navItems = [
    {
      name: '比較',
      icon: Scale,
      href: '/compare',
      active: currentPath === '/compare',
    },
    {
      name: 'お得',
      icon: ShoppingBag,
      href: '/deals',
      active: currentPath === '/deals',
    },
    {
      name: 'プロフィール',
      icon: User,
      href: '/profile/favorites',
      active: currentPath.startsWith('/profile'),
    },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-50 bg-white border-t border-gray-200 md:hidden">
      <div className="grid grid-cols-4 gap-1 px-2 py-2">
        {navItems.map((item) => {
          const Icon = item.icon;
          return (
            <a
              key={item.name}
              href={item.href}
              className={`flex flex-col items-center justify-center h-14 rounded-xl transition-colors ${item.active
                ? 'text-primary-600 bg-primary-50'
                : 'text-gray-600 hover:text-gray-900 hover:bg-gray-50'
                }`}
              aria-current={item.active ? 'page' : undefined}
            >
              <Icon className="w-5 h-5 mb-1" />
              <span className="text-xs font-medium">{item.name}</span>
            </a>
          );
        })}
      </div>
    </nav>
  );
}
