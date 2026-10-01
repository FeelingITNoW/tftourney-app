import { createRateLimiter } from "../../rate-limit";
import type {
  RiotAccountResponse,
  RiotConfig,
  VerifiedRiotAccount,
} from "./types";

export class RiotConfigError extends Error {
  constructor() {
    super("Riot API is not configured. Set RIOT_API_KEY in .env.local.");
    this.name = "RiotConfigError";
  }
}

export class RiotAccountNotFoundError extends Error {
  constructor() {
    super("Riot account was not found. Check the GameName#TAG and try again.");
    this.name = "RiotAccountNotFoundError";
  }
}

export class RiotRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RiotRequestError";
  }
}

export class RiotRateLimitError extends RiotRequestError {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(`Too many Riot ID lookups. Try again in ${retryAfterSeconds} second${retryAfterSeconds === 1 ? "" : "s"}.`);
    this.name = "RiotRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

// Per-caller cap on Riot ID lookups so one player can't burn the shared Riot
// API key's quota. Only callers that pass a rateLimitKey are limited.
const riotLookupLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 1000 });

export function resetRiotLookupLimiter(): void {
  riotLookupLimiter.reset();
}

const allowedAccountRegions = new Set(["americas", "asia", "europe", "sea"]);

function getRiotConfig(): RiotConfig {
  const apiKey = process.env.RIOT_API_KEY;
  const accountRegion = (
    process.env.RIOT_ACCOUNT_REGION ?? "asia"
  ).toLowerCase();

  if (!apiKey) {
    throw new RiotConfigError();
  }

  if (!allowedAccountRegions.has(accountRegion)) {
    throw new RiotRequestError(
      "RIOT_ACCOUNT_REGION must be one of americas, asia, europe, or sea.",
    );
  }

  return {
    apiKey,
    accountRegion,
  };
}

export async function getRiotAccountByRiotId(
  input: {
    gameName: string;
    tagLine: string;
  },
  options: { rateLimitKey?: string } = {},
): Promise<VerifiedRiotAccount> {
  const config = getRiotConfig();
  if (options.rateLimitKey) {
    const limit = riotLookupLimiter.check(options.rateLimitKey);
    if (!limit.ok) throw new RiotRateLimitError(limit.retryAfterSeconds);
  }
  const encodedGameName = encodeURIComponent(input.gameName);
  const encodedTagLine = encodeURIComponent(input.tagLine);
  const response = await fetch(
    `https://${config.accountRegion}.api.riotgames.com/riot/account/v1/accounts/by-riot-id/${encodedGameName}/${encodedTagLine}`,
    {
      cache: "no-store",
      headers: {
        "X-Riot-Token": config.apiKey,
      },
    },
  );

  if (response.status === 404) {
    throw new RiotAccountNotFoundError();
  }

  if (response.status === 401 || response.status === 403) {
    throw new RiotRequestError("Riot API rejected the configured API key.");
  }

  if (response.status === 429) {
    throw new RiotRequestError("Riot API rate limit reached. Try again later.");
  }

  if (!response.ok) {
    throw new RiotRequestError(
      `Riot API request failed with ${response.status}.`,
    );
  }

  const account = (await response.json()) as RiotAccountResponse;

  return {
    puuid: account.puuid,
    gameName: account.gameName,
    tagLine: account.tagLine,
    gameTag: `${account.gameName}#${account.tagLine}`,
  };
}
