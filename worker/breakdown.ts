import type {
  ContributionBreakdown,
  ContributionKind,
  BreakdownRepository,
} from "../shared/types.ts";
import { yearRange } from "./github.ts";

export type BreakdownWindow = ContributionBreakdown["window"];
interface RawRepository {
  repository: { nameWithOwner: string; url: string; isPrivate: boolean };
  contributions: { totalCount: number };
}
export interface RawCollection {
  login: string;
  contributionCalendar: { totalContributions: number };
  restrictedContributionsCount: number;
  totalCommitContributions: number;
  totalPullRequestContributions: number;
  totalIssueContributions: number;
  totalPullRequestReviewContributions: number;
  totalRepositoryContributions: number;
  commitContributionsByRepository: RawRepository[];
  pullRequestContributionsByRepository: RawRepository[];
  issueContributionsByRepository: RawRepository[];
  pullRequestReviewContributionsByRepository: RawRepository[];
}
const FIELDS = [
  ["commits", "totalCommitContributions", "commitContributionsByRepository"],
  ["pullRequests", "totalPullRequestContributions", "pullRequestContributionsByRepository"],
  ["issues", "totalIssueContributions", "issueContributionsByRepository"],
  ["reviews", "totalPullRequestReviewContributions", "pullRequestReviewContributionsByRepository"],
] as const;

export function breakdownFromCollections(
  login: string,
  window: BreakdownWindow,
  collections: RawCollection[],
  generatedAt: string,
): ContributionBreakdown {
  let privateCount = collections.reduce((sum, c) => sum + c.restrictedContributionsCount, 0);
  const kinds = FIELDS.map(([kind, totalField, listField]) => {
    let total = 0;
    const repos = new Map<string, BreakdownRepository>();
    for (const c of collections) {
      total += c[totalField];
      for (const entry of c[listField]) {
        const count = entry.contributions.totalCount;
        if (entry.repository.isPrivate) {
          privateCount += count;
          total -= count;
          continue;
        }
        const key = entry.repository.nameWithOwner.toLowerCase();
        const found = repos.get(key);
        if (found) found.count += count;
        else
          repos.set(key, {
            nameWithOwner: entry.repository.nameWithOwner,
            url: entry.repository.url,
            count,
          });
      }
    }
    const repositories = [...repos.values()].sort(
      (a, b) => b.count - a.count || a.nameWithOwner.localeCompare(b.nameWithOwner),
    );
    return {
      kind: kind as ContributionKind,
      total,
      repositories,
      unlisted: Math.max(0, total - repositories.reduce((sum, r) => sum + r.count, 0)),
    };
  });
  kinds.push({
    kind: "repositories",
    total: collections.reduce((sum, c) => sum + c.totalRepositoryContributions, 0),
    repositories: [],
    unlisted: 0,
  });
  const calendarTotal = collections.reduce(
    (sum, c) => sum + c.contributionCalendar.totalContributions,
    0,
  );
  return {
    login,
    accounts: collections.map((c) => c.login),
    window,
    calendarTotal,
    kinds,
    private: privateCount,
    other: calendarTotal - privateCount - kinds.reduce((sum, k) => sum + k.total, 0),
    generatedAt,
  };
}

/**
 * Measures a breakdown against the total the page already shows. The board
 * reads GitHub's public calendar HTML, which can disagree with GraphQL's
 * calendar around today and day boundaries; the gap goes to `other` rather
 * than leaving two different totals on one page.
 */
export function reconcileBreakdown(
  breakdown: ContributionBreakdown,
  shownTotal: number,
): ContributionBreakdown {
  const parts = breakdown.private + breakdown.kinds.reduce((sum, kind) => sum + kind.total, 0);
  return { ...breakdown, calendarTotal: shownTotal, other: shownTotal - parts };
}

export function parseBreakdownDate(raw: string | null, now: Date): string | null | "invalid" {
  if (raw === null) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return "invalid";
  const [year, month, day] = raw.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    year < 2008 ||
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  )
    return "invalid";
  const normalized = date.toISOString().slice(0, 10);
  return normalized <= now.toISOString().slice(0, 10) ? normalized : "invalid";
}
export function yearWindow(year: number, now: Date): BreakdownWindow {
  return { kind: "year", year, ...yearRange(year, now) };
}
export function dayWindow(date: string): BreakdownWindow {
  return {
    kind: "day",
    date,
    from: `${date}T00:00:00Z`,
    to: `${date}T23:59:59Z`,
  };
}
/** A window still counts as live for a day after it ends: GitHub may still
 *  revise the latest day, and a fetch that crosses midnight must not be
 *  filed as finished and pinned for a month. */
const LIVE_MARGIN_MS = 24 * 60 * 60 * 1000;

export function breakdownTtl(window: BreakdownWindow, now: Date): number {
  return Date.parse(window.to) > now.getTime() - LIVE_MARGIN_MS ? 60 : 30 * 24 * 60 * 60;
}
