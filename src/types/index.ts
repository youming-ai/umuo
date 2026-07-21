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

// Betting line for a match — home/draw/away moneyline, handicap spread, and
// over/under total, plus the sportsbook name and ESPN's own summary string.
// Sourced from either a scoreboard event's odds[0] (Odds tab) or a summary
// payload's pickcenter (match detail); both sport adapters parse into this one
// shape. Fields are null when the feed omits them; drawMoneyLine is soccer-only.
export interface MatchOdds {
  provider: string;
  details: string; // ESPN's own line summary, e.g. "MEX -230"
  spread: number | null;
  overUnder: number | null;
  homeMoneyLine: number | null;
  awayMoneyLine: number | null;
  drawMoneyLine?: number | null; // soccer 3-way price; unset for 2-way sports
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
  // matches; resolves penalty-shootout winners where the regulation/ET score
  // is level. Undefined for draws and group games.
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
  // Betting line from the scoreboard event's competition.odds[0] (moneyline /
  // spread / total). null when the feed omits odds for this fixture. Powers the
  // per-competition Odds tab; parsed in each sport adapter's scoreboard transform.
  odds?: MatchOdds | null;
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

// A single leaderboard row for the season leaders pipeline (eng.1 goals /
// nba points). Unlike TopScorer (tournament scoreboard aggregation, kept for
// future tournament comps), this is assembled server-side from ESPN's core.api leaders
// endpoint + athlete/team $ref fan-out. `displayValue` is ESPN's own format
// ("27" / "30.2") so we sidestep the total-vs-per-game question; `value` is
// the numeric sort key. Rows are NOT clickable (no player-page nav).
export interface Leader {
  rank: number; // 1-based, sorted by value desc
  name: string; // athlete displayName ('' if the ref failed to resolve)
  teamName: string; // '' if unknown
  teamLogo: string; // team crest URL, '' if unknown
  displayValue: string; // ESPN raw display, e.g. "27" or "30.2"
  value: number; // numeric value for sorting
}

// --- news (Phase 2) ---

// An entity parsed from an article's ESPN `categories` (team/athlete/league).
// Rendered as a plain label — news is per-competition, so there is no
// entity-scoped news route to link into.
export interface NewsTag {
  kind: 'team' | 'athlete' | 'league';
  label: string;
  team?: string;
}

export interface NewsItem {
  id: string;
  headline: string;
  description: string;
  published: string; // ISO
  byline: string;
  imageUrl: string; // '' when the headline has no image
  link: string; // external espn.com article URL (links.web.href)
  tags: NewsTag[];
}

// A team directory entry from ESPN's site.api teams list.
export interface TeamSummary {
  id: string;
  name: string;
  abbrev: string;
  logo: string;
  color: string; // hex without '#', may be ''
}

// --- team detail (site.api teams/{id} + roster + schedule + injuries) ---
export interface RosterPlayer {
  id: string;
  name: string;
  jersey: string;
  position: string;
}
export interface TeamGame {
  id: string;
  date: string; // ISO
  name: string; // e.g. "Switzerland at Argentina"
  detail: string; // final score ("2-1") when played, else status text
}
export interface TeamInjury {
  name: string;
  status: string; // "Out" / "Day-To-Day" / …
  detail: string; // short comment
}
export interface TeamDetail {
  id: string;
  name: string;
  logo: string;
  record: string; // "46-36" / ""
  standingSummary: string; // e.g. "3rd in Group A"
  roster: RosterPlayer[];
  schedule: TeamGame[];
  injuries: TeamInjury[];
}

// --- roster moves (NBA transactions + league injuries) ---
export interface TransactionItem {
  date: string; // ISO
  description: string;
  team: string; // team display name
}
export interface LeagueInjuryGroup {
  team: string;
  players: { name: string; status: string }[];
}
