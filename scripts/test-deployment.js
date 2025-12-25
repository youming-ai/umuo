#!/usr/bin/env node

import { execSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const tests = [
  {
    name: 'Build Test',
    test: async () => {
      try {
        execSync('npm run build', { stdio: 'pipe' });
        return { success: true, message: '✓ Build successful' };
      } catch (error) {
        return { success: false, message: `✗ Build failed: ${error.message}` };
      }
    },
  },
  {
    name: 'Directory Structure Test',
    test: async () => {
      const requiredDirs = [
        'dist',
        'src/components',
        'src/pages',
        'src/layouts',
      ];
      const missingDirs = requiredDirs.filter((dir) => !fs.existsSync(dir));

      if (missingDirs.length === 0) {
        return { success: true, message: '✓ All required directories exist' };
      } else {
        return {
          success: false,
          message: `✗ Missing directories: ${missingDirs.join(', ')}`,
        };
      }
    },
  },
  {
    name: 'Static Files Test',
    test: async () => {
      const requiredFiles = ['dist/index.html', 'dist/search/index.html'];
      const missingFiles = requiredFiles.filter((file) => !fs.existsSync(file));

      if (missingFiles.length === 0) {
        return {
          success: true,
          message: '✓ All required static files generated',
        };
      } else {
        return {
          success: false,
          message: `✗ Missing files: ${missingFiles.join(', ')}`,
        };
      }
    },
  },
  {
    name: 'Bundle Size Test',
    test: async () => {
      const distDir = 'dist';
      let totalSize = 0;

      function calculateDirSize(dir) {
        const files = fs.readdirSync(dir);

        for (const file of files) {
          const filePath = path.join(dir, file);
          const stat = fs.statSync(filePath);

          if (stat.isDirectory()) {
            calculateDirSize(filePath);
          } else {
            totalSize += stat.size;
          }
        }
      }

      if (fs.existsSync(distDir)) {
        calculateDirSize(distDir);
      }

      const sizeKB = Math.round(totalSize / 1024);
      const sizeMB = (totalSize / (1024 * 1024)).toFixed(2);

      if (totalSize < 5 * 1024 * 1024) {
        // Less than 5MB
        return {
          success: true,
          message: `✓ Bundle size: ${sizeKB} KB (${sizeMB} MB)`,
        };
      } else {
        return { success: false, message: `✗ Bundle too large: ${sizeMB} MB` };
      }
    },
  },
  {
    name: 'Image Optimization Test',
    test: async () => {
      const imageDir = 'public/images';

      if (!fs.existsSync(imageDir)) {
        return {
          success: true,
          message: 'ℹ No images directory found (optional)',
        };
      }

      const imageFiles = fs
        .readdirSync(imageDir)
        .filter((file) => /\.(jpg|jpeg|png|webp|avif)$/i.test(file));

      if (imageFiles.length === 0) {
        return { success: true, message: 'ℹ No images found (optional)' };
      }

      return {
        success: true,
        message: `✓ Found ${imageFiles.length} images for optimization`,
      };
    },
  },
];

async function runTests() {
  console.log('🚀 Running UMUO Astro Deployment Tests\n');

  const results = [];
  let passedTests = 0;

  for (const test of tests) {
    console.log(`Running ${test.name}...`);

    try {
      const result = await test.test();
      results.push(result);

      if (result.success) {
        console.log(`  ${result.message}`);
        passedTests++;
      } else {
        console.log(`  ${result.message}`);
      }
    } catch (error) {
      const errorResult = {
        success: false,
        message: `✗ Test failed with error: ${error.message}`,
      };
      results.push(errorResult);
      console.log(`  ${errorResult.message}`);
    }

    console.log('');
  }

  // Summary
  console.log('📊 Test Summary:');
  console.log(`Passed: ${passedTests}/${tests.length}`);

  if (passedTests === tests.length) {
    console.log('🎉 All tests passed! Ready for deployment.');
    process.exit(0);
  } else {
    console.log(
      '❌ Some tests failed. Please fix the issues before deploying.',
    );
    process.exit(1);
  }
}

// Check if running directly
if (import.meta.url === `file://${process.argv[1]}`) {
  runTests().catch(console.error);
}

export { runTests, tests };
