export interface ApiCatalogTarget {
  href: string;
  type: "application/json";
  title: string;
}

export interface ApiCatalog {
  linkset: Array<{
    anchor: string;
    item: ApiCatalogTarget[];
  }>;
}

/** RFC 9727 API catalog, expressed as the RFC 9264 JSON Linkset format. */
export function apiCatalog(origin: string, logins: readonly string[]): ApiCatalog {
  const base = origin.replace(/\/$/, "");
  return {
    linkset: [
      {
        anchor: `${base}/.well-known/api-catalog`,
        item: [
          {
            href: `${base}/api/board`,
            type: "application/json",
            title: "Leaderboard for the current year; accepts an optional year query parameter",
          },
          {
            href: `${base}/api/all`,
            type: "application/json",
            title: "All-time leaderboard",
          },
          {
            href: `${base}/api/history`,
            type: "application/json",
            title: "What each board check saw: totals and changed days; accepts optional from and to query parameters",
          },
          ...logins.flatMap((login) => [
            {
              href: `${base}/api/users/${login}`,
              type: "application/json" as const,
              title: `All-time and current-year data for ${login}`,
            },
            {
              href: `${base}/api/users/${login}/breakdown`,
              type: "application/json" as const,
              title: `Contribution breakdown for ${login}; accepts an optional date query parameter`,
            },
            {
              href: `${base}/api/users/${login}/history`,
              type: "application/json" as const,
              title: `What each board check saw for ${login}; accepts optional from and to query parameters`,
            },
            {
              href: `${base}/api/users/${login}/insights`,
              type: "application/json" as const,
              title: `Cached public PR style insights for ${login}; pending until a background refresh`,
            },
          ]),
        ],
      },
    ],
  };
}
