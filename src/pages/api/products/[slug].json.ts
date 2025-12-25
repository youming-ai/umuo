import { mockService } from '../../../lib/mock/service';

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

export function getStaticPaths() {
  const products = mockService.getProducts({ limit: 100 }).products;
  return products.map((product) => ({
    params: { slug: product.slug },
  }));
}

// API endpoint for getting product details by slug
export async function GET({
  params,
  request,
}: {
  params: { slug: string };
  request: Request;
}) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  const { slug } = params;

  const product = mockService.getProductBySlug(slug);

  if (!product) {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'PRODUCT_NOT_FOUND',
          message: `Product with slug '${slug}' not found`,
        },
      }),
      {
        status: 404,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      },
    );
  }

  // Calculate additional product metrics
  const prices = product.retailers?.map((r) => r.price) || [product.price];
  const lowestPrice = Math.min(...prices);
  const highestPrice = Math.max(...prices);
  const maxSavings = highestPrice - lowestPrice;
  const averageRating = product.rating;

  // Add calculated metrics to response
  const enhancedProduct = {
    ...product,
    metrics: {
      lowestPrice,
      highestPrice,
      maxSavings,
      averageRating,
      priceDropPercentage: Math.round(
        (product.discount / product.originalPrice) * 100,
      ),
    },
    seo: {
      title: `${product.name} - UMUO`,
      description: `${product.name}の最安値を比較。${product.retailers?.length || 0}店舗の価格をリアルタイムでチェック。現在の最安値は¥${lowestPrice.toLocaleString()}。`,
      keywords: `${product.name}, ${product.brand}, ${product.category}, 価格比較, 最安値`,
    },
  };

  return new Response(
    JSON.stringify({
      success: true,
      data: enhancedProduct,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
        'Cache-Control': 'public, max-age=300', // Cache for 5 minutes
      },
    },
  );
}

// Handle CORS preflight requests
export async function OPTIONS(request: Request) {
  const origin = request.headers.get('origin');
  const corsHeaders = getCorsHeaders(origin);

  return new Response(null, {
    status: 204, // No Content
    headers: corsHeaders,
  });
}
