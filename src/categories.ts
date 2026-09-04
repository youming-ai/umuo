// Category registry — the single validation gate for category values: URL
// segments (/<key>), feed-filter values, KV-key safety, and the enrichment
// fallback all check against this record. Adding a category is registry-only.
export interface Category {
  key: string; // URL first segment, e.g. 'keyboards'
  label: string; // display name
  group: CategoryGroupKey; // rail section, see CATEGORY_GROUPS
}

export type CategoryGroupKey = 'ai' | 'consumer' | 'hardware' | 'peripherals';

/** Rail/navigation sections in display order. */
export const CATEGORY_GROUPS: { key: CategoryGroupKey; label: string }[] = [
  { key: 'ai', label: 'AI' },
  { key: 'consumer', label: 'Consumer Electronics' },
  { key: 'hardware', label: 'PC Hardware' },
  { key: 'peripherals', label: 'Peripherals' },
];

const category = (key: string, label: string, group: CategoryGroupKey): Category => ({
  key,
  label,
  group,
});

export const CATEGORIES: Record<string, Category> = {
  // AI
  ai: category('ai', 'AI', 'ai'),
  // Consumer electronics
  phones: category('phones', 'Phones', 'consumer'),
  tablets: category('tablets', 'Tablets', 'consumer'),
  laptops: category('laptops', 'Laptops', 'consumer'),
  // PC hardware
  gpu: category('gpu', 'GPUs', 'hardware'),
  cpu: category('cpu', 'CPUs & Motherboards', 'hardware'),
  memory: category('memory', 'Memory', 'hardware'),
  storage: category('storage', 'Storage', 'hardware'),
  monitor: category('monitor', 'Monitors', 'hardware'),
  cooling: category('cooling', 'Cases & Cooling', 'hardware'),
  // Peripherals
  keyboards: category('keyboards', 'Keyboards', 'peripherals'),
  mice: category('mice', 'Mice', 'peripherals'),
  audio: category('audio', 'Audio', 'peripherals'),
  gear: category('gear', 'Gear', 'peripherals'),
};

/** Label for a stored category key, falling back to the raw key when the
 *  registry has moved on (old rows must still render). */
export function categoryLabel(key: string | null): string {
  if (!key) return '';
  return CATEGORIES[key]?.label ?? key;
}
