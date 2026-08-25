import { describe, expect, it } from 'vitest';
import { imgProxyUrl } from './site';

describe('imgProxyUrl', () => {
  it('upgrades BBC 240px thumbnails to 1024px', () => {
    const src =
      'https://ichef.bbci.co.uk/ace/standard/240/cpsprodpb/c48a/live/32146830-9a52-11f1-bc7b-a36e7e7ea706.jpg';
    expect(imgProxyUrl(src)).toBe(
      'https://ichef.bbci.co.uk/ace/standard/1024/cpsprodpb/c48a/live/32146830-9a52-11f1-bc7b-a36e7e7ea706.jpg',
    );
  });

  it('leaves other sources untouched', () => {
    const src = 'https://static.independent.co.uk/2026/08/17/15/foo.jpg?width=1200';
    expect(imgProxyUrl(src)).toBe(src);
  });
});
