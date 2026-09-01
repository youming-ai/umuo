// Category registry — the single validation gate for category values: URL
// segments (/<key>), feed-filter values, KV-key safety, and the enrichment
// fallback all check against this record. Adding a category is registry-only.
export interface Category {
  key: string; // URL first segment, e.g. 'keyboards'
  label: string; // display name
}

const category = (key: string, label: string): Category => ({ key, label });

export const CATEGORIES: Record<string, Category> = {
  // Peripherals
  keyboards: category('keyboards', 'Keyboards'),
  mice: category('mice', 'Mice'),
  audio: category('audio', 'Audio'),
  gear: category('gear', 'Gear'),
  // PC hardware
  gpu: category('gpu', 'GPUs'),
  cpu: category('cpu', 'CPUs & Motherboards'),
  memory: category('memory', 'Memory'),
  storage: category('storage', 'Storage'),
  monitor: category('monitor', 'Monitors'),
  cooling: category('cooling', 'Cases & Cooling'),
};

/** Label for a stored category key, falling back to the raw key when the
 *  registry has moved on (old rows must still render). */
export function categoryLabel(key: string | null): string {
  if (!key) return '';
  return CATEGORIES[key]?.label ?? key;
}
