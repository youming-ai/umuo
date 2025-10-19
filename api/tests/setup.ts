/**
 * Test setup file for Jest
 * Configures global test environment and mocks
 */

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  // Uncomment to ignore specific console methods during tests
  // log: jest.fn(),
  // debug: jest.fn(),
  // info: jest.fn(),
  // warn: jest.fn(),
  // error: jest.fn(),
};

// Set default timeout for async operations
jest.setTimeout(10000);

// Global test utilities
declare global {
  namespace jest {
    interface Matchers<R> {
      toBeValidISODate(): R;
      toBeWithinRange(min: number, max: number): R;
    }
  }
}

// Custom matchers
expect.extend({
  toBeValidISODate(received: string) {
    const pass = !isNaN(Date.parse(received));
    return {
      message: () =>
        pass
          ? `expected ${received} not to be a valid ISO date`
          : `expected ${received} to be a valid ISO date`,
      pass,
    };
  },
  toBeWithinRange(received: number, min: number, max: number) {
    const pass = received >= min && received <= max;
    return {
      message: () =>
        pass
          ? `expected ${received} not to be within range ${min} - ${max}`
          : `expected ${received} to be within range ${min} - ${max}`,
      pass,
    };
  },
});