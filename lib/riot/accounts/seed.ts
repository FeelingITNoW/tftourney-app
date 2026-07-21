/**
 * Riot IDs copied from the ranked SEA snapshot in supabase/seed.sql.
 *
 * These are identifiers, not API keys or other secrets. The server still
 * resolves each selected ID through Riot before it is registered.
 */
export const SEEDED_RIOT_IDS = [
  "FuuTime#xdd",
  "ffstars#8787",
  "ทนายPong#1244",
  "FS Foeman#bundd",
  "Kathrina Irene#tin",
  "ZzzTina#SEA",
  "Braven#ph2",
  "Dodes#MD3",
  "Houston3001#9594",
  "TTVBubu1150#qquer",
  "k4yj#7914",
  "cjwei98#cjw98",
  "Havok#BEE",
  "freezingfiref#SG2",
  "teennn#TH22",
  "PunNyไง#lnwza",
  "kitai#0801",
  "TS jose#1023",
  "HERTA#127",
  "ZeroNXD#xdx",
  "TaNTaNCE#3443",
  "TS Stryggar#004",
  "Sugappy#ooo",
  "mashimomo#971",
  "outboxer009#333",
  "Dubu#2227",
  "AXM Juswa Garcia#AXM",
  "sayy35#1622",
  "luluinblue#1008",
  "Player 5#0111",
  "AXM Maha#TFT",
  "ScuttleCat#3309",
  "TFTmobile#oloGS",
  "acheron#hui",
  "i love faker#dave",
  "Echidna#2333",
  "BALANCEZZ#117",
  "TTVDude1323#ngum",
  "skrh#65656",
  "DASIES#AIMER",
  "penjamin city#pepe",
  "Adeus#1011",
  "AXM Vincent#maru",
  "ทนายChamp#1221",
  "darkdagger#Enryu",
  "ADEARTHLH#LHNO1",
  "蔡徐坤#01121",
  "Berlin#sryze",
  "OLY Chigu El#Oly",
  "JustADonutz#727",
  "卧槽1#CNM",
  "angery#ooo",
  "Final Flash#322",
  "TS mode#tft",
  "Reso#RESO",
  "no1 contester#6969",
  "TSM Doublelift#tsmd",
  "FansIGXNo3#Tammm",
  "two thirty nine#239",
  "Lil Rhythm#SEA",
  "cecalis#zc1",
  "flylovetantan28#21423",
  "ShadowRealm#SG2",
  "borgir#cheez",
  "pika#LLL",
  "เบาเบา#SEA",
  "blackwhite2310#1110",
  "bunty991#4685",
  "pakorn#5424",
  "Leafy#0322",
  "FindOut#SG2",
  "hoj#011",
  "NotRoyce#1103",
  "OBE Maple#AYAYA",
  "Kureaa#Kirei",
  "AlNe#9898",
  "TTVBibi1450#shiro",
  "JIL#1265",
  "AXM Gettey#AXM",
  "Nowhere#6286",
  "แทน#7502",
  "Nottstyle#TFTM",
  "Brian477#477",
  "Doni#KGAGU",
  "maxxine#sleep",
  "Xander#4022",
  "YutaTFT#1704",
  "Intentions#20266",
  "Coldbloodleo#3336",
  "Eunseo#0111",
  "Sumthing#Spoky",
  "ghost of a#smile",
  "ChristianprddWTF#71101",
  "moonlight#信仰27",
  "Johan#byou",
  "SMIAER#4444",
  "Ephraim#4LYF",
  "Freek#0611",
  "BLACKY2#4444",
  "dusk abuser#dev",
  "VA Turbo#Beer",
  "Jesse#NtHim",
  "baterson14#bater",
  "MKL Koshiro#0902",
  "bigemilywngfan69#OBE",
  "YJlnwZa#007",
  "Nico Robin#qtqt",
  "Jhun#iicy",
  "FOND#FFFF",
  "underscores#milk",
  "Nerumo#7777",
  "มะนาวโซบะ#NotYu",
  "Rczz#8101",
  "DoctoringWho#doc",
  "Buahlil1#mbg",
  "ราชานรก Reyleigh#7777",
  "emile#SG2",
  "RisenRampart#RR1",
  "BACK2DECEMBER#2705",
  "Chicken Tocino#ph2",
  "Rozu#4610",
  "NickyNick#Nick",
  "nitefox23#NA1",
  "felidae#8421",
  "Imteor3#radio",
  "iLuvReze#Reze",
  "TofuDonburi#dubu",
  "Rochiester#1313",
] as const;

function normalizeRiotId(riotId: string): string {
  return riotId.trim().toLowerCase();
}

function shuffle<T>(values: readonly T[], random: () => number): T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  return shuffled;
}

export function selectRandomSeededRiotIds(
  existingRiotIds: readonly string[],
  count: number,
  random: () => number = Math.random,
): string[] {
  if (!Number.isFinite(count) || count <= 0) {
    return [];
  }

  const existing = new Set(existingRiotIds.map(normalizeRiotId));
  const available = SEEDED_RIOT_IDS.filter((riotId) => !existing.has(normalizeRiotId(riotId)));

  return shuffle(available, random).slice(0, Math.floor(count));
}
