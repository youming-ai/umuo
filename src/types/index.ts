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

export type MatchStatus = 'finished' | 'live' | 'upcoming';

// ESPN's finer-grained status for an in-progress or recently-completed match.
// `status` mirrors the upstream status.type.state; `clock` is the current
// minute (0 when not playing); `displayClock` is what the UI should render
// (e.g. "23'", "45'+2'", "HT", "FT", "90'+5'"); `period` is the half number
// (1, 2 — or 3/4 for ET, 5 for penalties during knockouts).
export type ProgressStatus = 'pre' | 'in' | 'halftime' | 'post';

export interface MatchProgress {
  status: ProgressStatus;
  clock: number;
  displayClock: string;
  period: number;
}

export type Stage = 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final';

// One scoring play: a player scoring in a specific match minute. Carries
// the ESPN athlete id so the /player/[id] page can find goals without
// name-matching. `tag` is a display-only suffix (e.g. " (p)" for
// penalties, " (OG)" for own goals) derived from the scoring play's
// `type.text`.
export interface ScorerEntry {
  playerId: string;
  name: string;
  minute: string; // "45'", "45'+2'", "67'", etc.
  tag: '' | ' (p)' | ' (OG)';
}

export interface CompMatch {
  id: string;
  homeName: string;
  awayName: string;
  homeFlag: string;
  awayFlag: string;
  homeId: string; // ESPN team id for the home side
  awayId: string; // ESPN team id for the away side
  homeScore: number | null;
  awayScore: number | null;
  group?: string; // was required; NBA doesn't provide a group
  kickoff: Date | null;
  status: MatchStatus;
  stage?: Stage; // was required; NBA doesn't provide a stage
  homeScorers: ScorerEntry[];
  awayScorers: ScorerEntry[];
  venue: string; // "Estadio Azteca · Mexico City" or '' when unknown
  // URL-friendly identifier (home-vs-away, lowercased, hyphenated). Used
  // by the /match/[slug] route to deep-link directly to a match detail
  // page. Derived in the soccer adapter from the team names via slugify().
  slug: string;
  // NBA uses ESPN's status.type.shortDetail ("Final" / "Q4 2:14" / "OT");
  // soccer leaves this unset and keeps using the progress/finishType logic
  // below. UI prefers this when present rather than inventing period text.
  statusText?: string;
  // Optional richer status (only set when not 'upcoming'). For 'finished' this
  // carries the FT clock; for 'live' it carries the current minute or HT.
  progress?: MatchProgress;
  // Which side won (from ESPN's competitor.winner). Set for finished knockout
  // matches; lets the bracket resolve penalty-shootout winners where the
  // regulation/ET score is level. Undefined for draws and group games.
  winner?: 'home' | 'away';
  // How a finished knockout match was decided when not in regulation:
  // 'aet' = after extra time, 'pens' = decided on penalties. Derived from
  // ESPN's status.type.name (STATUS_FINAL_AET / STATUS_FINAL_PEN). Undefined
  // for regulation finishes and group games.
  finishType?: 'aet' | 'pens';
  // Penalty-shootout score (ESPN competitor.shootoutScore). Set only when
  // finishType === 'pens'. The main home/awayScore stays the regulation+ET
  // aggregate (often level), so these carry the actual decider.
  homeShootoutScore?: number;
  awayShootoutScore?: number;
}

export interface WCStanding {
  teamId: string;
  name: string;
  flag: string;
  mp: number;
  w: number;
  d: number;
  l: number;
  gf: number;
  ga: number;
  gd: number;
  pts: number;
  // Last-5 form as a 5-character string of W/D/L codes, oldest first
  // (the rightmost character is the most recent result). Built from
  // ESPN's `competitor.form` field, captured at the same time as the
  // scoreboard parse. May be undefined for teams that haven't played
  // 5 matches yet.
  form?: string;
}

export interface WCGroup {
  name: string;
  standings: WCStanding[];
}

export interface TeamStatRow {
  label: string;
  home: string; // ESPN displayValue, e.g. "54%", "21"
  away: string;
}
export interface PlayEvent {
  clock: string; // e.g. "45'+3'" or "" for pre-match notes
  text: string;
  teamId: string | null; // set for key plays, null for general commentary
  type: string; // e.g. "Goal", "Yellow Card", "" for commentary
}
export interface LineupPlayer {
  jersey: string;
  name: string;
  pos: string; // position.abbreviation, e.g. "CD-R", "G"
  starter: boolean;
  subbedInAt?: string; // minute the player came on
  subbedOutAt?: string; // minute the player went off
  card?: 'yellow' | 'red';
}
export interface TeamLineup {
  teamId: string;
  teamName: string;
  formation: string; // e.g. "4-3-3"
  players: LineupPlayer[];
}
// Tournament top scorers, aggregated from the per-team `leaders` array
// in ESPN's scoreboard response. One row per distinct player.
export interface TopScorer {
  athleteId: string;
  name: string;
  teamId: string;
  teamName: string; // resolved via the team name cache inside the soccer adapter
  teamFlag: string; // team crest URL, resolved from the standings feed
  goals: number;
}
