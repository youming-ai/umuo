import { categories, priceHistory, products } from './data';

export const mockService = {
  getProducts: (params: any = {}) => {
    const {
      searchQuery,
      category,
      subcategory,
      platform,
      minPrice,
      maxPrice,
      sort,
      page = 1,
      limit = 20,
    } = params;

    let filtered = [...products];

    // Generate many products for pagination if needed
    if (filtered.length < 100) {
      const baseLen = filtered.length;
      for (let i = 0; i < 100 - baseLen; i++) {
        const base = filtered[i % baseLen];
        filtered.push({
          ...base,
          id: `${base.id}-${i}`,
          slug: `${base.slug}-${i}`,
          name: `${base.name} (Ref ${i + 1})`,
          price: base.price + Math.floor(Math.random() * 5000) - 2500,
          rating: Number((3.5 + Math.random() * 1.5).toFixed(1)),
          reviewCount: Math.floor(Math.random() * 1000),
        });
      }
    }

    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      filtered = filtered.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.brand.toLowerCase().includes(q),
      );
    }

    if (category) {
      filtered = filtered.filter((p) => p.category === category);
    }

    if (subcategory) {
      filtered = filtered.filter((p) => p.subcategory === subcategory);
    }

    if (platform) {
      filtered = filtered.filter((p) => p.platform === platform);
    }

    if (minPrice) filtered = filtered.filter((p) => p.price >= minPrice);
    if (maxPrice) filtered = filtered.filter((p) => p.price <= maxPrice);

    // Sorting
    switch (sort) {
      case 'price_low':
        filtered.sort((a, b) => a.price - b.price);
        break;
      case 'price_high':
        filtered.sort((a, b) => b.price - a.price);
        break;
      case 'rating':
        filtered.sort((a, b) => b.rating - a.rating);
        break;
      case 'discount':
        filtered.sort((a, b) => b.discount - a.discount);
        break;
      default:
        filtered.sort((a, b) => b.rating - a.rating);
    }

    const totalResults = filtered.length;
    const totalPages = Math.ceil(totalResults / limit);
    const start = (page - 1) * limit;
    const paginated = filtered.slice(start, start + limit);

    return {
      products: paginated,
      pagination: {
        currentPage: page,
        totalPages,
        totalResults,
        limit,
        hasNext: page < totalPages,
        hasPrev: page > 1,
      },
    };
  },

  getProductBySlug: (slug: string) => {
    return products.find((p) => p.slug === slug) || null;
  },

  getCategories: () => {
    return categories;
  },

  getCategoryByName: (name: string) => {
    return categories.find((c) => c.name === name) || null;
  },

  getPriceHistory: (id: string) => {
    // Return mock history, maybe slightly varied by id
    return priceHistory.map((h) => ({
      ...h,
      price: h.price + (parseInt(id, 10) % 5) * 1000,
    }));
  },

  getFeaturedDeals: () => {
    return products.slice(0, 3);
  },
};
