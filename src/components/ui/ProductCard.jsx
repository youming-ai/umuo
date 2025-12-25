import { BarChart2, ShoppingCart, Star } from 'lucide-react';
import { memo } from 'react';
import { calculateDiscountPercentage, formatPrice } from '../../lib/utils';
import { Badge } from './badge';
import { Button } from './button';
import { Card, CardContent } from './card';

// Placeholder image for products without images
const PLACEHOLDER_IMAGE =
  'data:image/svg+xml,%3Csvg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300"%3E%3Crect width="400" height="300" fill="%23f3f4f6"/%3E%3Ctext x="50%25" y="50%25" dominant-baseline="middle" text-anchor="middle" font-family="sans-serif" font-size="20" fill="%239ca3af"%3ENo Image%3C/text%3E%3C/svg%3E';

function ProductCard({ product }) {
  const discountPercentage = calculateDiscountPercentage(
    product.originalPrice,
    product.price,
  );

  // Get image source with fallback
  const imageSrc = product.images?.[0] || product.image || PLACEHOLDER_IMAGE;

  const handleImageError = (e) => {
    e.currentTarget.src = PLACEHOLDER_IMAGE;
  };

  return (
    <Card className="group overflow-hidden border-gray-100 hover:border-primary-200 hover:shadow-xl hover:shadow-primary-500/5 transition-all duration-500">
      <a href={`/products/${product.slug}`} className="block">
        {/* Image Header */}
        <div className="relative overflow-hidden aspect-[4/3] bg-gray-50">
          <img
            src={imageSrc}
            alt={product.name || 'Product image'}
            className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-105"
            onError={handleImageError}
            loading="lazy"
          />

          {/* Platform Badge */}
          <div className="absolute top-3 left-3 z-20">
            <Badge variant="glass">{product.platform}</Badge>
          </div>

          {/* Discount Badge */}
          {discountPercentage > 0 && (
            <div className="absolute top-3 right-3 z-20">
              <Badge variant="destructive">{discountPercentage}% OFF</Badge>
            </div>
          )}
        </div>

        <CardContent className="p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest text-[0.65rem]">
              {product.brand || ''}
            </span>
            <div className="flex items-center text-yellow-500">
              <Star className="w-3 h-3 fill-current mr-1" />
              <span className="text-xs font-bold text-gray-700">
                {product.rating || 0}
              </span>
            </div>
          </div>

          <h3 className="font-bold text-lg leading-snug mb-2 line-clamp-2 h-14 group-hover:text-primary-600 transition-colors">
            {product.name}
          </h3>

          <div className="flex flex-col gap-1 mt-4">
            <div className="flex items-baseline gap-2">
              <span className="text-2xl font-black text-gray-900">
                ¥{formatPrice(product.price)}
              </span>
              {product.originalPrice > product.price && (
                <span className="text-sm text-gray-400 line-through font-medium">
                  ¥{formatPrice(product.originalPrice)}
                </span>
              )}
            </div>
            <p className="text-[10px] font-bold text-green-600 uppercase tracking-tighter">
              在庫あり
            </p>
          </div>
        </CardContent>
      </a>

      {/* Footer Actions */}
      <div className="px-5 pb-5 flex gap-2">
        <Button className="flex-1" size="lg" asChild>
          <a href={`/products/${product.slug}`}>
            <ShoppingCart className="w-4 h-4 mr-2" />
            詳細へ
          </a>
        </Button>
        <Button variant="outline" size="icon" className="h-10 w-10 shrink-0">
          <BarChart2 className="w-4 h-4" />
        </Button>
      </div>
    </Card>
  );
}

// Memoize to prevent unnecessary re-renders
export default memo(ProductCard, (prevProps, nextProps) => {
  return (
    prevProps.product.id === nextProps.product.id &&
    prevProps.product.price === nextProps.product.price &&
    prevProps.product.originalPrice === nextProps.product.originalPrice &&
    prevProps.product.rating === nextProps.product.rating
  );
});
