import { z } from 'zod';

export const CategorySchema = z.object({
  id: z.string(),
  name: z.record(z.string()), // Localized names
  parentId: z.string().optional(),
  level: z.number().positive(),
});

export const ProductImageSchema = z.object({
  url: z.string().url(),
  alt: z.record(z.string()), // Localized alt text
  width: z.number().positive(),
  height: z.number().positive(),
  order: z.number().nonnegative(),
});

export const ProductSpecificationSchema = z.object({
  name: z.string(),
  value: z.string(),
  unit: z.string().optional(),
});

export const ProductIdentifiersSchema = z.object({
  jan: z.string().optional(),
  upc: z.string().optional(),
  ean: z.string().optional(),
  asin: z.string().optional(),
  sku: z.string().optional(),
});

export const ProductSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(200),
  description: z.string().optional(),
  brand: z.string().optional(),
  category: CategorySchema,
  images: z.array(ProductImageSchema),
  specifications: z.array(ProductSpecificationSchema),
  identifiers: ProductIdentifiersSchema,
  status: z.enum(['active', 'discontinued', 'out_of_stock']),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export type Category = z.infer<typeof CategorySchema>;
export type ProductImage = z.infer<typeof ProductImageSchema>;
export type ProductSpecification = z.infer<typeof ProductSpecificationSchema>;
export type ProductIdentifiers = z.infer<typeof ProductIdentifiersSchema>;
export type Product = z.infer<typeof ProductSchema>;

export class ProductModel {
  static create(productData: Omit<Product, 'id' | 'createdAt' | 'updatedAt'>): Product {
    const now = new Date();
    return {
      ...productData,
      id: crypto.randomUUID(),
      createdAt: now,
      updatedAt: now,
    };
  }

  static validate(product: unknown): Product {
    return ProductSchema.parse(product);
  }

  static sanitizeName(name: string): string {
    return name.trim().substring(0, 200);
  }

  static sanitizeDescription(description?: string): string | undefined {
    if (!description) return undefined;
    return description.trim().substring(0, 2000);
  }

  static isActive(product: Product): boolean {
    return product.status === 'active';
  }

  static isDiscontinued(product: Product): boolean {
    return product.status === 'discontinued';
  }

  static hasIdentifiers(product: Product): boolean {
    return !!(product.identifiers.jan ||
             product.identifiers.upc ||
             product.identifiers.ean ||
             product.identifiers.asin ||
             product.identifiers.sku);
  }

  static getJANCode(product: Product): string | undefined {
    return product.identifiers.jan;
  }

  static getASIN(product: Product): string | undefined {
    return product.identifiers.asin;
  }

  static getCategoryName(product: Product, language: 'ja' | 'en' | 'zh' = 'ja'): string {
    return product.category.name[language] || product.category.name['ja'] || product.category.name['en'] || 'Unknown';
  }

  static hasValidImages(product: Product): boolean {
    return product.images.length > 0 &&
           product.images.every(img =>
             img.url &&
             img.width > 0 &&
             img.height > 0
           );
  }

  static getPrimaryImage(product: Product): ProductImage | null {
    const sortedImages = [...product.images].sort((a, b) => a.order - b.order);
    return sortedImages[0] || null;
  }

  static getSpecificationValue(product: Product, name: string): string | undefined {
    const spec = product.specifications.find(s => s.name === name);
    return spec ? spec.value : undefined;
  }

  static hasSpecifications(product: Product): boolean {
    return product.specifications.length > 0;
  }
}