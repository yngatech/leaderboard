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
          ...logins.map((login) => ({
            href: `${base}/api/users/${login}`,
            type: "application/json" as const,
            title: `All-time and current-year data for ${login}`,
          })),
        ],
      },
    ],
  };
}
