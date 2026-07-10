import { describe, expect, it } from 'vitest';
import { getAdapter } from '.';

describe('getAdapter', () => {
  it('rejects inherited object keys as unknown competition ids', () => {
    expect(() => getAdapter('constructor')).toThrow('Unknown competition: constructor');
  });
});
