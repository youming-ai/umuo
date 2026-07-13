// Live-stream domain types. Self-contained in the streams module so the whole
// feature can be removed post-tournament by deleting src/streams/.
export interface Substream {
  name: string;
  source_tag: string;
  iframe: string;
}

export interface Match {
  id: number;
  name: string;
  category_name: string;
  iframe: string;
  viewers: string;
  sourceTag?: string;
  substreams: Substream[];
  slug: string;
  poster?: string;
  colors?: string[];
  tag?: string;
  startsAt?: number; // unix seconds
  endsAt?: number; // unix seconds
  alwaysLive?: boolean;
}
