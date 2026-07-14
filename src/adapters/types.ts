import type {
  CompMatch,
  LineupPlayer,
  PlayEvent,
  TeamLineup,
  MatchOdds,
  TeamStatRow,
  TopScorer,
  WCGroup,
} from '../types';
import type { TeamForm } from './summaryExtras';

export interface ConferenceTable {
  name: string; // 'Eastern Conference' | 'Western Conference'
  rows: {
    teamId: string;
    name: string;
    logo: string;
    w: number;
    l: number;
    pct: string;
    gb: string;
  }[];
}

export type StandingsData =
  | { kind: 'soccer'; groups: WCGroup[] }
  | { kind: 'basketball'; conferences: ConferenceTable[] };

export interface BoxscoreTable {
  teamId: string;
  teamName: string;
  labels: string[]; // ESPN 原样：MIN PTS FG 3PT FT REB AST TO …
  players: { name: string; starter: boolean; dnp: boolean; stats: string[] }[];
}

export type MatchDetail =
  | {
      kind: 'soccer';
      homeId: string;
      awayId: string;
      stats: TeamStatRow[];
      allPlays: PlayEvent[];
      keyPlays: PlayEvent[];
      lineups: TeamLineup[];
      venue: string;
      attendance: number | null;
      odds: MatchOdds | null;
      form: TeamForm[];
    }
  | {
      kind: 'basketball';
      homeId: string;
      awayId: string;
      teamStats: TeamStatRow[];
      playerTables: BoxscoreTable[];
      venue: string;
      attendance: number | null;
      odds: MatchOdds | null;
      form: TeamForm[];
    };

export interface SportAdapter {
  transform(
    scoreboardJson: unknown,
    standingsJson: unknown,
  ): { matches: CompMatch[]; standings: StandingsData; scorers: TopScorer[] };
  transformSummary(json: unknown): MatchDetail;
}

// re-export LineupPlayer so soccer.ts can import from one place if desired
export type { LineupPlayer };
