import { Clock, Search, TrendingUp, X, Zap } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '../ui/button';
import { Card } from '../ui/card';
import { Input } from '../ui/input';

const TRENDING_KEYWORDS = [
  'iPhone 15 Pro',
  'MacBook Air M2',
  'Sony WH-1000XM5',
  'Nintendo Switch',
  'AirPods Pro 2',
];

export default function SearchBar({ placeholder = '欲しい商品を検索...' }) {
  const [query, setQuery] = useState('');
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [isFocused, setIsFocused] = useState(false);
  const searchContainerRef = useRef(null);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (
        searchContainerRef.current &&
        !searchContainerRef.current.contains(event.target)
      ) {
        setShowSuggestions(false);
        setIsFocused(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (query.trim()) {
      window.location.href = `/search?q=${encodeURIComponent(query.trim())}`;
    }
  };

  const handleKeywordClick = (keyword) => {
    window.location.href = `/search?q=${encodeURIComponent(keyword)}`;
  };

  return (
    <div
      className="relative w-full max-w-4xl mx-auto z-50"
      ref={searchContainerRef}
    >
      <form onSubmit={handleSubmit} className="relative group">
        <div
          className={`
          relative flex items-center transition-all duration-500 rounded-full overflow-hidden
          ${isFocused ? 'ring-8 ring-primary-500/10 shadow-2xl shadow-primary-500/20' : 'shadow-lg shadow-gray-200/50'}
        `}
        >
          <div className="absolute left-6 text-gray-400 group-hover:text-primary-500 transition-colors pointer-events-none z-10">
            <Search
              className={`w-6 h-6 ${isFocused ? 'text-primary-600' : ''}`}
            />
          </div>

          <Input
            type="text"
            className={`
              w-full h-16 pl-16 pr-32 bg-white border-2 text-lg font-bold text-gray-900 outline-none transition-all rounded-full border-transparent
              ${isFocused ? 'border-primary-500' : 'hover:border-gray-100'}
            `}
            placeholder={placeholder}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onFocus={() => {
              setShowSuggestions(true);
              setIsFocused(true);
            }}
          />

          <div className="absolute right-3 flex items-center gap-2">
            {query && (
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => setQuery('')}
                className="text-gray-400 hover:text-gray-600 rounded-full"
              >
                <X className="w-5 h-5" />
              </Button>
            )}
            <Button
              type="submit"
              className="px-8 h-10 rounded-full font-black text-sm shadow-lg shadow-primary-500/20"
            >
              SEARCH
            </Button>
          </div>
        </div>

        {/* Quick Suggestions Overlay */}
        {showSuggestions && (
          <Card className="absolute top-full left-0 right-0 mt-4 bg-white/95 backdrop-blur-2xl border border-gray-100 rounded-[2.5rem] shadow-2xl p-8 animate-fade-in overflow-hidden z-20">
            <div className="absolute top-0 right-0 p-8 opacity-5">
              <Zap className="w-32 h-32" />
            </div>

            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-6">
                <TrendingUp className="w-5 h-5 text-primary-600" />
                <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em]">
                  Trending Now
                </h3>
              </div>

              <div className="flex flex-wrap gap-3">
                {TRENDING_KEYWORDS.map((keyword) => (
                  <Button
                    key={keyword}
                    type="button"
                    variant="secondary"
                    size="lg"
                    onClick={() => handleKeywordClick(keyword)}
                    className="rounded-2xl font-bold text-sm hover:bg-primary-600 hover:text-white transition-all hover:scale-105 active:scale-95 border-transparent hover:shadow-xl hover:shadow-primary-500/20"
                  >
                    {keyword}
                  </Button>
                ))}
              </div>

              <div className="mt-10 pt-8 border-t border-gray-100">
                <div className="flex items-center gap-3 mb-4">
                  <Clock className="w-5 h-5 text-gray-400" />
                  <h3 className="text-xs font-black text-gray-400 uppercase tracking-[0.2em]">
                    Popular Categories
                  </h3>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                  {['スマートフォン', 'パソコン', 'カメラ', 'オーディオ'].map(
                    (cat) => (
                      <Button
                        key={cat}
                        type="button"
                        variant="link"
                        className="text-left py-2 px-0 h-auto text-sm font-bold text-gray-500 hover:text-primary-600 transition-colors justify-start"
                        onClick={() => {
                          window.location.href = `/search?category=${encodeURIComponent(cat)}`;
                        }}
                      >
                        {cat}
                      </Button>
                    ),
                  )}
                </div>
              </div>
            </div>
          </Card>
        )}
      </form>
    </div>
  );
}
