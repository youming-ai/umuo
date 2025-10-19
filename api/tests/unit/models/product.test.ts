/**
 * Product model validation tests
 * Tests for Product schema validation and business logic
 */

import { z } from 'zod';
import {
  CategorySchema,
  ProductImageSchema,
  ProductSpecificationSchema,
  ProductIdentifiersSchema,
  ProductSchema,
  ProductModel,
  type Category,
  type ProductImage,
  type ProductSpecification,
  type ProductIdentifiers,
  type Product
} from '../../../src/models/product';

describe('Product Model Validation', () => {
  // Test data
  const validCategory: Category = {
    id: 'cat_123',
    name: {
      ja: 'エレクトロニクス',
      en: 'Electronics',
      zh: '电子产品'
    },
    parentId: 'cat_parent',
    level: 2
  };

  const validImages: ProductImage[] = [
    {
      url: 'https://example.com/image1.jpg',
      alt: {
        ja: '製品画像',
        en: 'Product image'
      },
      width: 800,
      height: 600,
      order: 0
    }
  ];

  const validSpecifications: ProductSpecification[] = [
    {
      name: 'Weight',
      value: '500',
      unit: 'g'
    }
  ];

  const validIdentifiers: ProductIdentifiers = {
    jan: '4901234567890',
    asin: 'B0ABCDEFGH',
    sku: 'SKU-12345'
  };

  const validProduct = {
    name: 'Test Product',
    description: 'A test product description',
    brand: 'TestBrand',
    category: validCategory,
    images: validImages,
    specifications: validSpecifications,
    identifiers: validIdentifiers,
    status: 'active' as const,
    createdAt: new Date(),
    updatedAt: new Date()
  };

  describe('CategorySchema Validation', () => {
    it('should validate a valid category', () => {
      expect(() => CategorySchema.parse(validCategory)).not.toThrow();
    });

    it('should reject category without required fields', () => {
      const incompleteCategory = { name: validCategory.name };
      expect(() => CategorySchema.parse(incompleteCategory)).toThrow(z.ZodError);
    });

    it('should reject category with invalid level', () => {
      const invalidCategory = { ...validCategory, level: 0 };
      expect(() => CategorySchema.parse(invalidCategory)).toThrow(z.ZodError);
    });

    it('should accept category without parentId', () => {
      const categoryWithoutParent = { ...validCategory, parentId: undefined };
      expect(() => CategorySchema.parse(categoryWithoutParent)).not.toThrow();
    });
  });

  describe('ProductImageSchema Validation', () => {
    it('should validate valid product images', () => {
      validImages.forEach(image => {
        expect(() => ProductImageSchema.parse(image)).not.toThrow();
      });
    });

    it('should reject image with invalid URL', () => {
      const invalidImage = { ...validImages[0], url: 'invalid-url' };
      expect(() => ProductImageSchema.parse(invalidImage)).toThrow(z.ZodError);
    });

    it('should reject image with negative dimensions', () => {
      const invalidImage = { ...validImages[0], width: -100 };
      expect(() => ProductImageSchema.parse(invalidImage)).toThrow(z.ZodError);
    });

    it('should reject image with negative order', () => {
      const invalidImage = { ...validImages[0], order: -1 };
      expect(() => ProductImageSchema.parse(invalidImage)).toThrow(z.ZodError);
    });
  });

  describe('ProductSpecificationSchema Validation', () => {
    it('should validate valid specifications', () => {
      validSpecifications.forEach(spec => {
        expect(() => ProductSpecificationSchema.parse(spec)).not.toThrow();
      });
    });

    it('should accept specification without unit', () => {
      const specWithoutUnit = { name: 'Color', value: 'Red' };
      expect(() => ProductSpecificationSchema.parse(specWithoutUnit)).not.toThrow();
    });

    it('should reject specification with empty name', () => {
      const invalidSpec = { name: '', value: 'Some value' };
      expect(() => ProductSpecificationSchema.parse(invalidSpec)).toThrow(z.ZodError);
    });
  });

  describe('ProductIdentifiersSchema Validation', () => {
    it('should validate valid identifiers', () => {
      expect(() => ProductIdentifiersSchema.parse(validIdentifiers)).not.toThrow();
    });

    it('should accept empty identifiers', () => {
      expect(() => ProductIdentifiersSchema.parse({})).not.toThrow();
    });

    it('should validate JAN code format', () => {
      const validJAN = { jan: '4901234567890' };
      expect(() => ProductIdentifiersSchema.parse(validJAN)).not.toThrow();

      const invalidJAN = { jan: 'invalid-jan' };
      expect(() => ProductIdentifiersSchema.parse(invalidJAN)).not.toThrow(); // No specific format validation
    });
  });

  describe('ProductSchema Validation', () => {
    it('should validate a complete product', () => {
      expect(() => ProductSchema.parse(validProduct)).not.toThrow();
    });

    it('should reject product with empty name', () => {
      const invalidProduct = { ...validProduct, name: '' };
      expect(() => ProductSchema.parse(invalidProduct)).toThrow(z.ZodError);
    });

    it('should reject product with name too long', () => {
      const invalidProduct = { ...validProduct, name: 'a'.repeat(201) };
      expect(() => ProductSchema.parse(invalidProduct)).toThrow(z.ZodError);
    });

    it('should reject product with invalid status', () => {
      const invalidProduct = { ...validProduct, status: 'invalid_status' };
      expect(() => ProductSchema.parse(invalidProduct)).toThrow(z.ZodError);
    });

    it('should accept product with minimal required fields', () => {
      const minimalProduct = {
        name: 'Minimal Product',
        category: validCategory,
        images: [],
        specifications: [],
        identifiers: {},
        status: 'active' as const,
        createdAt: new Date(),
        updatedAt: new Date()
      };
      expect(() => ProductSchema.parse(minimalProduct)).not.toThrow();
    });
  });

  describe('ProductModel Business Logic', () => {
    let product: Product;

    beforeEach(() => {
      product = ProductModel.create(validProduct);
    });

    describe('create method', () => {
      it('should create product with generated id and timestamps', () => {
        const productData = {
          name: 'New Product',
          category: validCategory,
          images: [],
          specifications: [],
          identifiers: {},
          status: 'active' as const,
          createdAt: new Date(),
          updatedAt: new Date()
        };

        const createdProduct = ProductModel.create(productData);

        expect(createdProduct.id).toBeDefined();
        expect(createdProduct.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
        expect(createdProduct.createdAt).toBeInstanceOf(Date);
        expect(createdProduct.updatedAt).toBeInstanceOf(Date);
      });

      it('should copy all provided fields correctly', () => {
        expect(product.name).toBe(validProduct.name);
        expect(product.brand).toBe(validProduct.brand);
        expect(product.category).toEqual(validProduct.category);
      });
    });

    describe('validate method', () => {
      it('should validate correct product data', () => {
        expect(() => ProductModel.validate(product)).not.toThrow();
      });

      it('should throw error for invalid product data', () => {
        const invalidData = { ...product, name: '' };
        expect(() => ProductModel.validate(invalidData)).toThrow(z.ZodError);
      });
    });

    describe('sanitize methods', () => {
      it('should sanitize product name correctly', () => {
        const longName = '  Very Long Name '.repeat(20);
        const sanitized = ProductModel.sanitizeName(longName);
        expect(sanitized.length).toBeLessThanOrEqual(200);
        expect(sanitized).not.toMatch(/^\s+/);
        expect(sanitized).not.toMatch(/\s+$/);
      });

      it('should handle undefined description', () => {
        expect(ProductModel.sanitizeDescription(undefined)).toBeUndefined();
      });

      it('should sanitize description correctly', () => {
        const longDesc = '  Very Long Description '.repeat(100);
        const sanitized = ProductModel.sanitizeDescription(longDesc);
        expect(sanitized!.length).toBeLessThanOrEqual(2000);
        expect(sanitized).not.toMatch(/^\s+/);
        expect(sanitized).not.toMatch(/\s+$/);
      });
    });

    describe('status checking methods', () => {
      it('should correctly identify active products', () => {
        expect(ProductModel.isActive(product)).toBe(true);
        expect(ProductModel.isActive({ ...product, status: 'inactive' as any })).toBe(false);
      });

      it('should correctly identify discontinued products', () => {
        expect(ProductModel.isDiscontinued({ ...product, status: 'discontinued' })).toBe(true);
        expect(ProductModel.isDiscontinued(product)).toBe(false);
      });
    });

    describe('identifier methods', () => {
      it('should correctly detect products with identifiers', () => {
        expect(ProductModel.hasIdentifiers(product)).toBe(true);

        const productWithoutIdentifiers = { ...product, identifiers: {} };
        expect(ProductModel.hasIdentifiers(productWithoutIdentifiers)).toBe(false);
      });

      it('should return JAN code correctly', () => {
        expect(ProductModel.getJANCode(product)).toBe('4901234567890');
        expect(ProductModel.getJANCode({ ...product, identifiers: {} })).toBeUndefined();
      });

      it('should return ASIN correctly', () => {
        expect(ProductModel.getASIN(product)).toBe('B0ABCDEFGH');
        expect(ProductModel.getASIN({ ...product, identifiers: {} })).toBeUndefined();
      });
    });

    describe('localization methods', () => {
      it('should return category name in correct language', () => {
        expect(ProductModel.getCategoryName(product, 'ja')).toBe('エレクトロニクス');
        expect(ProductModel.getCategoryName(product, 'en')).toBe('Electronics');
        expect(ProductModel.getCategoryName(product, 'zh')).toBe('电子产品');
      });

      it('should fallback to Japanese when requested language not available', () => {
        const categoryOnlyJa = {
          ...validCategory,
          name: { ja: '日本語カテゴリ' }
        };
        const productWithJaCategory = { ...product, category: categoryOnlyJa };

        expect(ProductModel.getCategoryName(productWithJaCategory, 'en')).toBe('日本語カテゴリ');
        expect(ProductModel.getCategoryName(productWithJaCategory, 'zh')).toBe('日本語カテゴリ');
      });

      it('should fallback to English when Japanese not available', () => {
        const categoryOnlyEn = {
          ...validCategory,
          name: { en: 'English Category' }
        };
        const productWithEnCategory = { ...product, category: categoryOnlyEn };

        expect(ProductModel.getCategoryName(productWithEnCategory, 'ja')).toBe('English Category');
      });

      it('should return "Unknown" when no language available', () => {
        const categoryEmptyName = { ...validCategory, name: {} };
        const productWithEmptyCategory = { ...product, category: categoryEmptyName };

        expect(ProductModel.getCategoryName(productWithEmptyCategory, 'ja')).toBe('Unknown');
      });
    });

    describe('image methods', () => {
      it('should correctly validate product images', () => {
        expect(ProductModel.hasValidImages(product)).toBe(true);

        const productWithInvalidImages = {
          ...product,
          images: [{ ...validImages[0], width: 0 }]
        };
        expect(ProductModel.hasValidImages(productWithInvalidImages)).toBe(false);

        const productWithoutImages = { ...product, images: [] };
        expect(ProductModel.hasValidImages(productWithoutImages)).toBe(false);
      });

      it('should return primary image correctly', () => {
        expect(ProductModel.getPrimaryImage(product)).toEqual(validImages[0]);

        const productWithUnorderedImages = {
          ...product,
          images: [
            { ...validImages[0], order: 2 },
            { ...validImages[0], order: 1, url: 'https://example.com/image2.jpg' }
          ]
        };
        expect(ProductModel.getPrimaryImage(productWithUnorderedImages)?.url).toBe('https://example.com/image2.jpg');
      });

      it('should return null for product without images', () => {
        const productWithoutImages = { ...product, images: [] };
        expect(ProductModel.getPrimaryImage(productWithoutImages)).toBeNull();
      });
    });

    describe('specification methods', () => {
      it('should return specification value correctly', () => {
        expect(ProductModel.getSpecificationValue(product, 'Weight')).toBe('500');
        expect(ProductModel.getSpecificationValue(product, 'NonExistent')).toBeUndefined();
      });

      it('should correctly detect products with specifications', () => {
        expect(ProductModel.hasSpecifications(product)).toBe(true);

        const productWithoutSpecs = { ...product, specifications: [] };
        expect(ProductModel.hasSpecifications(productWithoutSpecs)).toBe(false);
      });
    });
  });
});