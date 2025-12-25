import { ChevronDown, ChevronUp, Star, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '../ui/button';
import { Input } from '../ui/input';

export default function FilterPanel({
  initialFilters,
  availableFilters,
  onFilterChange,
}) {
  const [filters, setFilters] = useState(initialFilters);
  const [expandedSections, setExpandedSections] = useState({
    category: true,
    platform: true,
    price: true,
    rating: false,
  });

  useEffect(() => {
    setFilters(initialFilters);
  }, [initialFilters]);

  const handleFilterChange = (filterType, value) => {
    const newFilters = { ...filters, [filterType]: value };
    setFilters(newFilters);

    // Dispatch event for InteractiveProductGrid to listen to
    window.dispatchEvent(
      new CustomEvent('filter-change', {
        detail: newFilters,
      }),
    );

    onFilterChange?.(newFilters);
  };

  const toggleSection = (section) => {
    setExpandedSections((prev) => ({
      ...prev,
      [section]: !prev[section],
    }));
  };

  const clearAllFilters = () => {
    const clearedFilters = {
      category: '',
      platform: '',
      minPrice: 0,
      maxPrice: 1000000,
      rating: 0,
    };
    setFilters(clearedFilters);

    // Dispatch event for cleared filters
    window.dispatchEvent(
      new CustomEvent('filter-change', {
        detail: clearedFilters,
      }),
    );

    onFilterChange?.(clearedFilters);
  };

  const hasActiveFilters =
    filters.category ||
    filters.platform ||
    filters.minPrice > 0 ||
    filters.maxPrice < 1000000 ||
    filters.rating > 0;

  return (
    <div className="space-y-8">
      {/* Clear Filters */}
      {/* Clear Filters */}
      {hasActiveFilters && (
        <div className="flex justify-end">
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            className="text-muted-foreground hover:text-foreground h-auto p-0 font-bold"
          >
            <X className="w-3.5 h-3.5 mr-1" />
            すべてクリア
          </Button>
        </div>
      )}

      {/* Category Filter */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => toggleSection('category')}
          className="flex justify-between items-center w-full group"
        >
          <span className="text-sm font-bold text-foreground group-hover:text-primary transition-colors uppercase tracking-widest text-[0.7rem]">
            カテゴリー
          </span>
          {expandedSections.category ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
          )}
        </button>

        {expandedSections.category && (
          <div className="pt-2 space-y-1">
            {availableFilters.categories.map((category) => (
              <label
                key={category}
                className="flex items-center group cursor-pointer py-1.5 px-2 rounded-lg hover:bg-accent transition-colors"
              >
                <input
                  type="radio"
                  name="category"
                  value={category}
                  checked={filters.category === category}
                  onChange={(e) =>
                    handleFilterChange('category', e.target.value)
                  }
                  className="w-4 h-4 text-primary focus:ring-ring border-input transition-all rounded-full"
                />
                <span
                  className={`ml-3 text-sm transition-colors ${filters.category === category ? 'text-primary font-bold' : 'text-muted-foreground group-hover:text-foreground'}`}
                >
                  {category}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Platform Filter */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => toggleSection('platform')}
          className="flex justify-between items-center w-full group"
        >
          <span className="text-sm font-bold text-foreground group-hover:text-primary transition-colors uppercase tracking-widest text-[0.7rem]">
            プラットフォーム
          </span>
          {expandedSections.platform ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
          )}
        </button>

        {expandedSections.platform && (
          <div className="pt-2 space-y-1">
            {availableFilters.platforms.map((platform) => (
              <label
                key={platform}
                className="flex items-center group cursor-pointer py-1.5 px-2 rounded-lg hover:bg-accent transition-colors"
              >
                <input
                  type="radio"
                  name="platform"
                  value={platform}
                  checked={filters.platform === platform}
                  onChange={(e) =>
                    handleFilterChange('platform', e.target.value)
                  }
                  className="w-4 h-4 text-primary focus:ring-ring border-input transition-all rounded-full"
                />
                <span
                  className={`ml-3 text-sm transition-colors ${filters.platform === platform ? 'text-primary font-bold' : 'text-muted-foreground group-hover:text-foreground'}`}
                >
                  {platform}
                </span>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Price Range Filter */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => toggleSection('price')}
          className="flex justify-between items-center w-full group"
        >
          <span className="text-sm font-bold text-foreground group-hover:text-primary transition-colors uppercase tracking-widest text-[0.7rem]">
            価格帯
          </span>
          {expandedSections.price ? (
            <ChevronUp className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
          ) : (
            <ChevronDown className="w-4 h-4 text-muted-foreground group-hover:text-primary" />
          )}
        </button>

        {expandedSections.price && (
          <div className="pt-2 space-y-4">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-xs">
                  ¥
                </span>
                <Input
                  type="number"
                  min="0"
                  max="10000000"
                  step="100"
                  placeholder="MIN"
                  value={filters.minPrice}
                  onChange={(e) => {
                    const value = Math.max(
                      0,
                      Math.min(10000000, parseInt(e.target.value, 10) || 0),
                    );
                    handleFilterChange('minPrice', value);
                  }}
                  className="pl-7 h-10 rounded-xl bg-background border-input text-foreground"
                />
              </div>
              <span className="text-muted-foreground">〜</span>
              <div className="relative flex-1">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-bold text-xs">
                  ¥
                </span>
                <Input
                  type="number"
                  min="0"
                  max="10000000"
                  step="100"
                  placeholder="MAX"
                  value={filters.maxPrice}
                  onChange={(e) => {
                    const value = Math.max(
                      0,
                      Math.min(10000000, parseInt(e.target.value, 10) || 0),
                    );
                    handleFilterChange('maxPrice', value);
                  }}
                  className="pl-7 h-10 rounded-xl bg-background border-input text-foreground"
                />
              </div>
            </div>

            {/* Quick Price Ranges */}
            <div className="grid grid-cols-1 gap-2">
              {availableFilters.priceRanges.map((range) => {
                const [minStr, maxStr] = range.split('〜');
                const min =
                  minStr === '' ? 0 : parseInt(minStr.replace(',', ''), 10);
                const max =
                  maxStr === ''
                    ? 999999
                    : parseInt(maxStr.replace(',', ''), 10);

                return (
                  <Button
                    key={range}
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      handleFilterChange('minPrice', min);
                      handleFilterChange('maxPrice', max);
                    }}
                    className="justify-start text-xs font-bold text-muted-foreground hover:text-foreground hover:bg-accent rounded-lg px-3"
                  >
                    {range}
                  </Button>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Rating Filter */}
      <div className="space-y-2">
        <button
          type="button"
          onClick={() => toggleSection('rating')}
          className="flex justify-between items-center w-full group"
        >
          <span className="text-sm font-bold text-gray-900 group-hover:text-primary-600 transition-colors uppercase tracking-widest text-[0.7rem]">
            評価
          </span>
          {expandedSections.rating ? (
            <ChevronUp className="w-4 h-4 text-gray-400 group-hover:text-primary-600" />
          ) : (
            <ChevronDown className="w-4 h-4 text-gray-400 group-hover:text-primary-600" />
          )}
        </button>

        {expandedSections.rating && (
          <div className="pt-2 space-y-1">
            {[4, 3, 2, 1].map((rating) => (
              <label
                key={rating}
                className="flex items-center group cursor-pointer py-1.5 px-2 rounded-lg hover:bg-accent transition-colors"
              >
                <input
                  type="radio"
                  name="rating"
                  value={rating}
                  checked={filters.rating === rating}
                  onChange={(e) =>
                    handleFilterChange('rating', parseInt(e.target.value, 10))
                  }
                  className="w-4 h-4 text-primary focus:ring-ring border-input transition-all rounded-full"
                />
                <div className="ml-3 flex items-center gap-1.5">
                  <div className="flex">
                    {Array.from({ length: 5 }, (_, i) => {
                      return (
                        <Star
                          key={i}
                          className={`w-3.5 h-3.5 ${i < rating ? 'text-primary fill-primary' : 'text-muted fill-muted'}`}
                        />
                      );
                    })}
                  </div>
                  <span
                    className={`text-xs transition-colors ${filters.rating === rating ? 'text-foreground font-bold' : 'text-muted-foreground group-hover:text-foreground'}`}
                  >
                    {rating}以上
                  </span>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
