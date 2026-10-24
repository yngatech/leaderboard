import { githubGraphql, GitHubError } from "./github.ts";
import { aggregateInsights, type InsightPullRequest, type PrInsights } from "./insights.ts";

// Small pages keep nested file/commit/author connections below GitHub's node cap.
const QUERY = `query PrInsights($q: String!, $after: String) {
  search(query: $q, type: ISSUE, first: 20, after: $after) {
    issueCount pageInfo { hasNextPage endCursor }
    nodes { ... on PullRequest {
      id title url headRefName createdAt mergedAt state additions deletions changedFiles body
      author { login } repository { nameWithOwner isPrivate }
      files(first: 100) { nodes { path additions deletions } pageInfo { hasNextPage } }
      commits(first: 50) { totalCount nodes { commit {
        message authors(first: 5) { totalCount nodes { name email user { login } } }
      } } }
    } }
  }
}`;
interface SearchResult {
  search: { issueCount: number; pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: (InsightPullRequest | null)[] };
}

/** Disjoint UTC months, including today. Search cannot return more than 1,000 per window. */
export function insightMonths(now: Date): { from: string; to: string }[] {
  return Array.from({ length: now.getUTCMonth() + 1 }, (_, month) => ({
    from: new Date(Date.UTC(now.getUTCFullYear(), month, 1)).toISOString().slice(0, 10),
    to: new Date(Math.min(Date.UTC(now.getUTCFullYear(), month + 1, 1) - 1, now.getTime())).toISOString().slice(0, 10),
  }));
}

export async function fetchInsights(token: string, login: string, accounts: readonly string[], now = new Date()): Promise<PrInsights> {
  const prs = new Map<string, InsightPullRequest>();
  const collect = async (account: string, from: string, to: string): Promise<void> => {
    let after: string | null = null;
    let seen = 0;
    let expected = 0;
    const ids = new Set<string>();
    let more = true;
    do {
      const payload: { data?: SearchResult | null; errors?: { message: string }[] } = await githubGraphql<SearchResult>(token, {
        query: QUERY, variables: { q: `author:${account} is:pr is:public created:${from}..${to} sort:created-asc`, after },
      }, true);
      if (!payload.data?.search || payload.errors?.length) throw new GitHubError("GitHub could not return complete PR insights.", 502);
      const page = payload.data.search;
      if (page.issueCount > 1000) {
        if (from === to) throw new GitHubError("A single day exceeds GitHub's PR search limit.", 502);
        const middle = new Date((Date.parse(from) + Date.parse(to)) / 2).toISOString().slice(0, 10);
        const next = new Date(Date.parse(middle) + 86400_000).toISOString().slice(0, 10);
        await collect(account, from, middle);
        await collect(account, next, to);
        return;
      }
      expected = Math.max(expected, page.issueCount);
      for (const pr of page.nodes) {
        if (!pr?.id) throw new GitHubError("GitHub returned an incomplete PR search result.", 502);
        ids.add(pr.id);
        // Visibility is checked again before aggregation. Raw metadata stays in memory only.
        if (!pr.repository.isPrivate) prs.set(pr.id, pr);
      }
      seen += page.nodes.length;
      more = page.pageInfo.hasNextPage;
      if (!more) break;
      if (!page.pageInfo.endCursor || page.pageInfo.endCursor === after || seen >= 1000)
        throw new GitHubError("GitHub truncated PR search results.", 502);
      after = page.pageInfo.endCursor;
    } while (more);
    if (ids.size !== expected) throw new GitHubError("GitHub PR search coverage changed during collection; try again later.", 502);
  };
  for (const account of accounts) {
    for (const window of insightMonths(now)) await collect(account, window.from, window.to);
  }
  return aggregateInsights(login, accounts, now.getUTCFullYear(), [...prs.values()], now.toISOString());
}
