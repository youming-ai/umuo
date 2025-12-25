import { mockService } from '../../lib/mock/service';

// Allowed origins for CORS
const ALLOWED_ORIGINS = [
  'http://localhost:4321', // Astro dev server
  'http://localhost:3000',
  'https://umuo.ai',
  'https://www.umuo.ai',
  process.env.PUBLIC_SITE_URL || '',
].filter(Boolean);

function getCorsHeaders(origin: string | null) {
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin || '')
    ? origin
    : ALLOWED_ORIGINS[0];

  return {
    'Access-Control-Allow-Origin': allowedOrigin,
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age': '86400', // 24 hours
  };
}

export async function GET({ url, request }: { url: URL; request: Request }) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  // Validate and sanitize input parameters
  const searchQuery = url.searchParams.get('q') || '';
  const category = url.searchParams.get('category') || '';
  const platform = url.searchParams.get('platform') || '';
  const sort = url.searchParams.get('sort') || 'relevance';

  // Validate numeric parameters with bounds checking
  const rawMinPrice = url.searchParams.get('minPrice');
  const rawMaxPrice = url.searchParams.get('maxPrice');
  const rawPage = url.searchParams.get('page');
  const rawLimit = url.searchParams.get('limit');

  const minPrice = Math.max(
    0,
    Math.min(10000000, parseInt(rawMinPrice || '0', 10) || 0),
  );
  const maxPrice = Math.max(
    0,
    Math.min(10000000, parseInt(rawMaxPrice || '999999', 10) || 999999),
  );
  const page = Math.max(1, Math.min(1000, parseInt(rawPage || '1', 10) || 1));
  const limit = Math.max(
    1,
    Math.min(100, parseInt(rawLimit || '12', 10) || 12),
  );

  const params = {
    searchQuery: searchQuery.slice(0, 100), // Limit query length
    category: category.slice(0, 50),
    platform: platform.slice(0, 50),
    minPrice,
    maxPrice,
    sort,
    page,
    limit,
  };

  const result = mockService.getProducts(params);

  return new Response(
    JSON.stringify({
      products: result.products,
      pagination: result.pagination,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
      },
    },
  );
}

export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  return new Response(null, {
    status: 204, // No Content
    headers: corsHeaders,
  });
}
