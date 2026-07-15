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
