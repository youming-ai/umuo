// ppv.to was seized by law enforcement (July 2026) — do not re-add it.
// The alt source (timstreams.st) serves its live embeds from full pages.dev
// project subdomains, pinned on purpose — never allowlist bare pages.dev.
// It migrated live events vileembeds.pages.dev -> ritzembeds.pages.dev (Jul 2026);
// vileembeds now only serves MMA replays, but stays pinned for older embeds.
const TRUSTED_STREAM_HOSTS = [
  'embedindia.st',
  'ppv.st',
  'vileembeds.pages.dev',
  'ritzembeds.pages.dev',
];

export function isTrustedStreamUrl(value: string | null | undefined): value is string {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    return TRUSTED_STREAM_HOSTS.some(
      (host) => url.hostname === host || url.hostname.endsWith(`.${host}`),
    );
  } catch {
    return false;
  }
}
