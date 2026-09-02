const DISCORD_USER_ID = /^[1-9]\d{16,19}$/;

export interface AllowedMentions {
  parse: string[];
  users?: string[];
}

export interface DiscordUserReference {
  text: string;
  userId?: string;
}

/** Parses the encrypted GitHub-login-to-Discord-ID mapping. */
export function parseDiscordUserIds(value: string | undefined): ReadonlyMap<string, string> {
  if (!value) return new Map();

  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error("DISCORD_USER_IDS must be a JSON object.");
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error("DISCORD_USER_IDS must be a JSON object.");
  }

  const users = new Map<string, string>();
  for (const [login, userId] of Object.entries(parsed)) {
    if (typeof userId !== "string" || !DISCORD_USER_ID.test(userId)) {
      throw new Error(`DISCORD_USER_IDS has an invalid ID for ${login}.`);
    }
    const normalizedLogin = login.toLowerCase();
    if (users.has(normalizedLogin)) {
      throw new Error(`DISCORD_USER_IDS repeats the GitHub login ${login}.`);
    }
    users.set(normalizedLogin, userId);
  }
  return users;
}

/** Uses a real mention when mapped, otherwise preserves the GitHub profile link. */
export function discordUserReference(
  login: string,
  githubUrl: string,
  userIds: ReadonlyMap<string, string>,
): DiscordUserReference {
  const userId = userIds.get(login.toLowerCase());
  return userId
    ? { text: `<@${userId}>`, userId }
    : { text: `[${login}](${githubUrl})` };
}

/** Keeps mentions disabled unless this particular notification names one user. */
export function allowedMentions(userId?: string): AllowedMentions {
  return userId ? { parse: [], users: [userId] } : { parse: [] };
}
