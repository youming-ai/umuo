/**
 * 将字符串转为 URL 友好的 kebab-case 格式
 * 支持 Unicode：先 NFD 分解再去掉组合音调符号，保留字母/数字/空白/横杠
 */
export function slugify(text: string): string {
  return text
    .normalize('NFD') // 分解 é → e + ́  (分音符)
    .replace(/[\u0300-\u036f]/g, '') // 移除所有组合音调符号
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // 移除非字母、非数字、非空白、非横杠字符
    .replace(/[\s_]+/g, '-') // 空白或下划线替换为单个横杠
    .replace(/-+/g, '-'); // 连续横杠替换为单个
}

const RTF = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

/** ISO timestamp → relative label ("2 hours ago"). '' if unparseable. */
export function timeAgo(iso: string | undefined, now = Date.now()): string {
  if (!iso) return '';
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return '';
  const diff = Math.round((then - now) / 1000); // seconds; negative = past
  const abs = Math.abs(diff);
  for (const [unit, secs] of UNITS) {
    if (abs >= secs) return RTF.format(Math.round(diff / secs), unit);
  }
  return RTF.format(diff, 'second');
}
