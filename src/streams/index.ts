// Live-stream module (World Cup only). Self-contained: nothing outside
// src/streams/ should import its internals — depend on this barrel instead.
// To remove the feature after the tournament, delete src/streams/ and this
// barrel's only consumers.
export { default as Player } from './Player';
export { useStreams } from './useStreams';
export { indexStreams, streamForMatch, liveStreamForMatch, isStreamLive } from './streamMatch';
export { isTrustedStreamUrl } from './streamSources';
export type { Match, Substream } from './types';
