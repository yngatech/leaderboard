interface Env {
  LEADERBOARD_API: Fetcher;
}

export const onRequest: PagesFunction<Env> = ({ request, env }) =>
  env.LEADERBOARD_API.fetch(request);
