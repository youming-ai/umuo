// API endpoint for comparing multiple products

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

  const productIds = url.searchParams.get('ids')?.split(',') || [];

  if (productIds.length < 2) {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'INSUFFICIENT_PRODUCTS',
          message: '少なくとも2つの商品を比較してください',
        },
      }),
      {
        status: 400,
        headers: {
          'Content-Type': 'application/json',
          ...corsHeaders,
        },
      },
    );
  }

  // Mock product database
  const mockProductDatabase: Record<string, any> = {
    '1': {
      id: '1',
      name: 'iPhone 15 Pro 256GB',
      description: 'A17 Proチップ搭載の最新iPhone',
      price: 148800,
      originalPrice: 159800,
      discount: 11000,
      platform: 'Amazon',
      rating: 4.8,
      reviewCount: 2341,
      images: ['/images/products/iphone-15-pro.jpg'],
      category: '家電',
      brand: 'Apple',
      specifications: {
        画面サイズ: '6.1インチ',
        ストレージ: '256GB',
        カメラ: '48MP',
        プロセッサ: 'A17 Pro',
        バッテリー: '3274mAh',
      },
    },
    '2': {
      id: '2',
      name: 'Sony WH-1000XM5',
      description: '業界最高レベルのノイズキャンセリング',
      price: 42900,
      originalPrice: 54900,
      discount: 12000,
      platform: '楽天',
      rating: 4.7,
      reviewCount: 1823,
      images: ['/images/products/sony-wh-1000xm5.jpg'],
      category: '家電',
      brand: 'Sony',
      specifications: {
        タイプ: '密闭动态型',
        ドライバー: '30mm',
        ノイズキャンセリング: 'QN1',
        バッテリー: '30時間',
        重量: '250g',
      },
    },
    '3': {
      id: '3',
      name: 'MacBook Air M2',
      description: 'M2チップ搭載の薄型軽量ノートPC',
      price: 139800,
      originalPrice: 154800,
      discount: 15000,
      platform: 'Yahoo!ショッピング',
      rating: 4.9,
      reviewCount: 892,
      images: ['/images/products/macbook-air-m2.jpg'],
      category: '家電',
      brand: 'Apple',
      specifications: {
        ディスプレイ: '13.6インチ',
        プロセッサ: 'M2',
        メモリ: '8GB',
        ストレージ: '256GB',
        バッテリー: '18時間',
        重量: '1.24kg',
      },
    },
  };

  // Get products to compare
  const productsToCompare = productIds
    .map((id) => mockProductDatabase[id])
    .filter((product) => product !== undefined);

  if (productsToCompare.length < 2) {
    return new Response(
      JSON.stringify({
        success: false,
        error: {
          code: 'PRODUCTS_NOT_FOUND',
          message: '指定された商品が見つかりませんでした',
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

  // Generate comparison table data
  const allSpecs = new Set();
  productsToCompare.forEach((product) => {
    if (product.specifications) {
      Object.keys(product.specifications).forEach((spec) => {
        allSpecs.add(spec);
      });
    }
  });

  const comparisonTable = Array.from(allSpecs).map((spec) => {
    const row: any = { spec };
    productsToCompare.forEach((product) => {
      row[`product_${product.id}`] = product.specifications?.[spec] || '-';
    });
    return row;
  });

  // Calculate comparison metrics
  const comparison = {
    products: productsToCompare,
    metrics: {
      lowestPrice: Math.min(...productsToCompare.map((p) => p.price)),
      highestPrice: Math.max(...productsToCompare.map((p) => p.price)),
      averagePrice: Math.round(
        productsToCompare.reduce((sum, p) => sum + p.price, 0) /
          productsToCompare.length,
      ),
      averageRating: (
        productsToCompare.reduce((sum, p) => sum + p.rating, 0) /
        productsToCompare.length
      ).toFixed(1),
      totalSavings: productsToCompare.reduce((sum, p) => sum + p.discount, 0),
    },
    table: comparisonTable,
    recommendations: {
      bestValue: productsToCompare.reduce((best, current) =>
        current.rating / current.price > best.rating / best.price
          ? current
          : best,
      ),
      highestRated: productsToCompare.reduce((best, current) =>
        current.rating > best.rating ? current : best,
      ),
      lowestPrice: productsToCompare.reduce((best, current) =>
        current.price < best.price ? current : best,
      ),
      biggestDiscount: productsToCompare.reduce((best, current) =>
        current.discount > best.discount ? current : best,
      ),
    },
  };

  return new Response(
    JSON.stringify({
      success: true,
      data: comparison,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        ...corsHeaders,
        'Cache-Control': 'public, max-age=60', // Cache for 1 minute
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
