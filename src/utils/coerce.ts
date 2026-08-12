// Defensive coercion for untyped/unstable ESPN JSON. A shape drift becomes a
// graceful empty value instead of a thrown TypeError.

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function obj(v: unknown): Record<string, unknown> {
  return isPlainObject(v) ? v : {};
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}

// string OR number → string; everything else → ''. Numbers coerce because
// ESPN sometimes returns a numeric value where a string is expected.
export function str(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}
