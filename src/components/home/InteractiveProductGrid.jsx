import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import ProductCard from '../ui/ProductCard.jsx';

export default function InteractiveProductGrid() {
  const [products, setProducts] = useState([]);
  const [pagination, setPagination] = useState({
    totalResults: 0,
    totalPages: 1,
    currentPage: 1,
    hasNext: false,
    hasPrev: false,
  });
  const [loading, setLoading] = useState(false);

  // Initialize from window global (only on client)
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const initialProducts = window.__INITIAL_PRODUCTS__ || [];
      const initialPagination = window.__INITIAL_PAGINATION__ || {
        totalResults: 0,
        totalPages: 1,
        currentPage: 1,
        hasNext: false,
        hasPrev: false,
      };
      setProducts(initialProducts);
      setPagination(initialPagination);
    }
  }, []);

  // Generate page numbers
  const pageNumbers = Array.from(
    { length: Math.min(pagination.totalPages, 5) },
    (_, i) =>
      Math.max(
        1,
        Math.min(pagination.currentPage - 2, pagination.totalPages - 4),
      ) + i,
  ).filter((pNum) => pNum > 0 && pNum <= pagination.totalPages);

  const fetchProducts = useCallback(async (filters) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.searchQuery) params.append('q', filters.searchQuery);
      if (filters.category) params.append('category', filters.category);
      if (filters.platform) params.append('platform', filters.platform);
      if (filters.minPrice > 0) params.append('minPrice', filters.minPrice);
      if (filters.maxPrice < 1000000)
        params.append('maxPrice', filters.maxPrice);
      if (filters.rating > 0) params.append('rating', filters.rating);
      if (filters.sort) params.append('sort', filters.sort);
      params.append('page', filters.page);
      params.append('limit', '12');

      const response = await fetch(`/api/search.json?${params.toString()}`);
      const data = await response.json();

      if (data.products) {
        setProducts(data.products);
        setPagination(data.pagination);
      }
    } catch (error) {
      console.error('Failed to fetch products:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Set up event listeners once
  useEffect(() => {
    let currentFilters = {
      searchQuery: '',
      category: '',
      platform: '',
      minPrice: 0,
      maxPrice: 1000000,
      rating: 0,
      sort: 'relevance',
      page: 1,
    };

    const handleCategorySelect = (e) => {
      currentFilters = {
        ...currentFilters,
        category: e.detail.category,
        page: 1,
      };
      fetchProducts(currentFilters);
    };

    const handleFilterChange = (e) => {
      currentFilters = {
        ...currentFilters,
        ...e.detail,
        page: 1,
      };
      fetchProducts(currentFilters);
    };

    const handleSearch = (e) => {
      currentFilters = {
        ...currentFilters,
        searchQuery: e.detail.query,
        page: 1,
      };
      fetchProducts(currentFilters);
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('category-selected', handleCategorySelect);
      window.addEventListener('filter-change', handleFilterChange);
      window.addEventListener('search-submit', handleSearch);
    }

    return () => {
      if (typeof window !== 'undefined') {
        window.removeEventListener('category-selected', handleCategorySelect);
        window.removeEventListener('filter-change', handleFilterChange);
        window.removeEventListener('search-submit', handleSearch);
      }
    };
  }, [fetchProducts]);

  const handlePageChange = (page) => {
    const filters = {
      searchQuery: '',
      category: '',
      platform: '',
      minPrice: 0,
      maxPrice: 1000000,
      rating: 0,
      sort: 'relevance',
      page,
    };
    fetchProducts(filters);
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  const handleSortChange = (sort) => {
    const filters = {
      searchQuery: '',
      category: '',
      platform: '',
      minPrice: 0,
      maxPrice: 1000000,
      rating: 0,
      sort,
      page: 1,
    };
    fetchProducts(filters);
  };

  if (loading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-8">
        {[1, 2, 3, 4, 5, 6].map((i) => (
          <div key={i} className="bg-gray-100 rounded-3xl h-96 animate-pulse" />
        ))}
      </div>
    );
  }

  if (products.length === 0) {
    return (
      <div className="bg-white rounded-[3rem] p-20 text-center border border-gray-100 shadow-sm">
        <div className="w-24 h-24 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-8">
          <svg
            className="w-10 h-10 text-gray-300"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"
            />
          </svg>
        </div>
        <h2 className="text-3xl font-black text-gray-900 mb-4">
          商品が見つかりませんでした
        </h2>
        <p className="text-gray-500 text-lg mb-10 max-w-md mx-auto">
          キーワードを変えて検索するか、他のカテゴリーをチェックしてみてください。
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Results Count */}
      <div className="flex justify-between items-center mb-6">
        <span className="text-sm text-gray-400 font-medium uppercase tracking-widest">
          Displaying {products.length} of {pagination.totalResults} results
        </span>

        {/* Sort Dropdown */}
        <select
          className="h-12 bg-white border border-gray-100 rounded-2xl px-6 text-sm font-bold text-gray-900 focus:ring-2 focus:ring-primary-500 shadow-sm outline-none appearance-none cursor-pointer"
          onChange={(e) => handleSortChange(e.target.value)}
        >
          <option value="relevance">おすすめ順</option>
          <option value="price_low">価格の低い順</option>
          <option value="price_high">価格の高い順</option>
          <option value="rating">評価の高い順</option>
          <option value="discount">割引率の高い順</option>
        </select>
      </div>

      {/* Products Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 md:gap-8 mb-12">
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className="flex justify-center items-center gap-3">
          {pagination.hasPrev && (
            <button
              type="button"
              onClick={() => handlePageChange(pagination.currentPage - 1)}
              className="w-12 h-12 rounded-2xl bg-white border border-gray-100 flex items-center justify-center hover:bg-primary-50 hover:text-primary-600 transition-all shadow-sm group"
            >
              <ChevronLeft className="w-5 h-5 group-hover:-translate-x-0.5 transition-transform" />
            </button>
          )}

          <div className="flex items-center gap-2">
            {pageNumbers.map((pNum) => {
              const isActive = pNum === pagination.currentPage;
              return (
                <button
                  type="button"
                  key={pNum}
                  onClick={() => handlePageChange(pNum)}
                  className={`w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-sm transition-all ${
                    isActive
                      ? 'bg-primary-600 text-white shadow-xl shadow-primary-500/30 ring-4 ring-primary-500/10'
                      : 'bg-white border border-gray-100 text-gray-400 hover:border-primary-200 hover:text-primary-600'
                  }`}
                >
                  {pNum}
                </button>
              );
            })}
          </div>

          {pagination.hasNext && (
            <button
              type="button"
              onClick={() => handlePageChange(pagination.currentPage + 1)}
              className="w-12 h-12 rounded-2xl bg-white border border-gray-100 flex items-center justify-center hover:bg-primary-50 hover:text-primary-600 transition-all shadow-sm group"
            >
              <ChevronRight className="w-5 h-5 group-hover:translate-x-0.5 transition-transform" />
            </button>
          )}
        </div>
      )}
    </div>
  );
}
