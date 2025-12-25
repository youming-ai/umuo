import { Heart, Menu, Settings, X } from 'lucide-react';
import { useState } from 'react';
import { Button } from '../ui/button';
import SearchBar from './SearchBar';

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  const menuItems = [
    { name: '比較', href: '/compare' },
    { name: 'お得', href: '/deals' },
  ];

  const profileMenuItems = [
    { name: 'お気に入り', href: '/profile/favorites', icon: Heart },
    { name: '閲覧履歴', href: '/profile/history', icon: Settings },
    { name: '価格アラート', href: '/profile/alerts', icon: Settings },
    { name: '設定', href: '/profile/settings', icon: Settings },
  ];

  return (
    <header className="fixed top-0 w-full z-50 backdrop-blur-lg bg-white/70 border-b border-gray-200">
      <div className="max-w-7xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <a href="/" className="flex items-center gap-2 group">
            <div className="w-9 h-9 bg-gradient-to-br from-primary-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg shadow-primary-500/30 group-hover:scale-110 transition-transform duration-300">
              <svg
                className="w-5 h-5 text-white"
                fill="currentColor"
                viewBox="0 0 20 20"
                aria-labelledby="logoTitle"
              >
                <title id="logoTitle">UMUO Logo</title>
                <path d="M10 2a8 8 0 100 16 8 8 0 000-16zM8 7a2 2 0 114 0 2 2 0 01-4 0z" />
                <path d="M10 12a2 2 0 100 4 2 2 0 000-4z" />
              </svg>
            </div>
            <span className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-gray-900 to-gray-600">
              UMUO
            </span>
          </a>

          {/* Desktop Search */}
          <div className="hidden md:flex flex-1 max-w-xl mx-8">
            <SearchBar />
          </div>

          {/* Desktop Nav */}
          <nav className="hidden md:flex items-center gap-6">
            {menuItems.map((item) => (
              <a
                key={item.name}
                href={item.href}
                className="text-sm font-medium text-gray-600 hover:text-primary-600 transition-colors"
              >
                {item.name}
              </a>
            ))}
            <div className="flex items-center gap-2 ml-4">
              <Button variant="ghost" size="sm" asChild>
                <a href="/profile/favorites">
                  <Heart className="w-4 h-4 mr-1" />
                </a>
              </Button>
              <Button variant="ghost" size="sm" asChild>
                <a href="/login">ログイン</a>
              </Button>
              <Button size="sm" asChild>
                <a href="/register">登録する</a>
              </Button>
            </div>
          </nav>

          {/* Mobile Menu Button */}
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
            className="md:hidden"
            aria-label={isMenuOpen ? 'Close menu' : 'Open menu'}
          >
            {isMenuOpen ? (
              <X className="w-6 h-6" />
            ) : (
              <Menu className="w-6 h-6" />
            )}
          </Button>
        </div>
      </div>

      {/* Mobile Menu */}
      {isMenuOpen && (
        <div className="md:hidden bg-white border-t border-gray-100 animate-fade-in">
          <div className="px-4 py-4">
            <SearchBar />
          </div>
          <nav className="px-4 pb-6 space-y-2">
            <div className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2 mt-2">
              Menu
            </div>
            {menuItems.map((item) => (
              <a
                key={item.name}
                href={item.href}
                className="block py-3 text-lg font-medium text-gray-700 hover:text-primary-600 transition-colors"
              >
                {item.name}
              </a>
            ))}
            <div className="text-xs font-black text-gray-400 uppercase tracking-widest mb-2 mt-4">
              Profile
            </div>
            {profileMenuItems.map((item) => (
              <a
                key={item.name}
                href={item.href}
                className="flex items-center gap-3 py-3 text-lg font-medium text-gray-700 hover:text-primary-600 transition-colors"
              >
                <item.icon className="w-5 h-5" />
                {item.name}
              </a>
            ))}
            <div className="pt-4 border-t border-gray-100 grid grid-cols-2 gap-4">
              <Button variant="outline" size="xl" asChild>
                <a href="/login">ログイン</a>
              </Button>
              <Button size="xl" asChild>
                <a href="/register">登録する</a>
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
