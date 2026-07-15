export type VerifiedRiotAccount = {
  puuid: string;
  gameName: string;
  tagLine: string;
  gameTag: string;
};

export type RiotAccountResponse = {
  puuid: string;
  gameName: string;
  tagLine: string;
};

export type RiotConfig = {
  apiKey: string;
  accountRegion: string;
};
