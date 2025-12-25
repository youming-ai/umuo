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

export default function SearchBar({
  placeholder = '欲しい商品を検索...',
  initialQuery = '',
}) {
  const [query, setQuery] = useState(initialQuery);
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
          ${isFocused ? 'ring-2 ring-ring shadow-lg' : 'shadow-sm border border-input'}
        `}
        >
          <div className="absolute left-6 text-muted-foreground group-hover:text-foreground transition-colors pointer-events-none z-10">
            <Search
              className={`w-6 h-6 ${isFocused ? 'text-primary' : ''}`}
            />
          </div>

          <Input
            type="text"
            className={`
              w-full h-16 pl-16 pr-32 bg-background border-none text-lg font-bold text-foreground outline-none transition-all rounded-full 
              placeholder:text-muted-foreground
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
                className="text-muted-foreground hover:text-foreground rounded-full"
              >
                <X className="w-5 h-5" />
              </Button>
            )}
            <Button
              type="submit"
              className="px-8 h-10 rounded-full font-black text-sm shadow-sm"
            >
              SEARCH
            </Button>
          </div>
        </div>

        {/* Quick Suggestions Overlay */}
        {showSuggestions && (
          <Card className="absolute top-full left-0 right-0 mt-4 bg-card/95 backdrop-blur-2xl border border-border rounded-[2rem] shadow-xl p-8 animate-fade-in overflow-hidden z-20">
            <div className="absolute top-0 right-0 p-8 opacity-5">
              <Zap className="w-32 h-32" />
            </div>

            <div className="relative z-10">
              <div className="flex items-center gap-3 mb-6">
                <TrendingUp className="w-5 h-5 text-primary" />
                <h3 className="text-xs font-black text-muted-foreground uppercase tracking-[0.2em]">
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
                    className="rounded-2xl font-bold text-sm hover:bg-primary hover:text-primary-foreground transition-all hover:scale-105 active:scale-95 border-transparent shadow-sm"
                  >
                    {keyword}
                  </Button>
                ))}
              </div>

              <div className="mt-10 pt-8 border-t border-border">
                <div className="flex items-center gap-3 mb-4">
                  <Clock className="w-5 h-5 text-muted-foreground" />
                  <h3 className="text-xs font-black text-muted-foreground uppercase tracking-[0.2em]">
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
                        className="text-left py-2 px-0 h-auto text-sm font-bold text-muted-foreground hover:text-primary transition-colors justify-start"
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
