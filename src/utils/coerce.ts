// Defensive coercion for untyped/unstable ESPN JSON. Every adapter and pure
// parser reaches into arbitrary ESPN shapes; these helpers turn a shape drift
// into a graceful empty value instead of a thrown TypeError. Centralized so
// the semantics stay uniform across the data layer — previously each module
// carried its own copy and `str` diverged (soccer/basketball/leaders dropped
// numbers, silently losing numeric ESPN values; the rest coerced them).

// Plain object = not null, not an array. Type guard so `obj()` narrows.
function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function obj(v: unknown): Record<string, unknown> {
  return isPlainObject(v) ? v : {};
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// string OR number → string; null/undefined/bool/object/array → ''. Numbers
// are coerced because ESPN sometimes returns a numeric value where a string
// was expected, and dropping it silently loses data.
export function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}
