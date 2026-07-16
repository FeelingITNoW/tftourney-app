-- Source requested: https://lolchess.gg/leaderboards?region=sea&mode=ranked
-- Machine-readable snapshot: https://tft.tools/leaderboards/ranked/sea
-- Snapshot: 2026-07-16, top 128 SEA ranked players.
--
-- This seed is intentionally limited to a tournament and its registrations.
-- It does not create participants, rounds, lobbies, or scores, so the
-- tournament remains open and has not started.
do $$
declare
  seed_tournament_name constant text := 'SEA Leaderboard Invitational';
  seed_tournament_id public.tournaments.id%type;
  seeded_at constant timestamptz := '2026-07-16 00:00:00+00';
begin
  delete from public.tournaments
  where name = seed_tournament_name;

  insert into public.tournaments (
    host_user_id,
    name,
    status,
    max_players,
    format_id,
    format_config,
    current_round_id,
    started_at,
    created_at,
    updated_at
  )
  values (
    1,
    seed_tournament_name,
    'accepting_players',
    128,
    'default',
    $format$
    {
      "id": "default",
      "name": "Default TFT Tournament Format",
      "isDefault": true,
      "placementPoints": {
        "1": 8,
        "2": 7,
        "3": 6,
        "4": 5,
        "5": 4,
        "6": 3,
        "7": 2,
        "8": 1
      },
      "rounds": [
        {
          "id": "opening-round",
          "name": "Opening Round",
          "type": "qualifier",
          "participants": "all_registered_players",
          "lobbySeeding": "snake",
<<<<<<< HEAD
          "games": 2,
=======
          "games": 6,
          "reseed": 2,
>>>>>>> 67350be (Added multi-round support)
          "standings": {
            "rankingMetric": "points",
            "sortDirection": "desc",
            "tieBreakers": [
              {
                "rankingMetric": "current_round_firsts",
                "sortDirection": "desc"
              },
              {
                "rankingMetric": "round_entry_seed",
                "sortDirection": "asc"
              }
            ]
          },
          "reseedStandings": {
            "rankingMetric": "tournament_points",
            "sortDirection": "desc",
            "tieBreakers": [
              {
                "rankingMetric": "current_round_firsts",
                "sortDirection": "desc"
              },
              {
                "rankingMetric": "round_entry_seed",
                "sortDirection": "asc"
              }
            ]
          },
          "advancement": {
            "type": "top_n",
            "count": 8,
            "rankingMetric": "points",
            "destinationRoundId": "final-round"
          }
        },
        {
          "id": "final-round",
          "name": "Final Round",
          "type": "final",
          "participants": "advanced_from_opening-round",
          "lobbySeeding": "random",
<<<<<<< HEAD
          "games": 2,
=======
          "games": 6,
          "reseed": 2,
>>>>>>> 67350be (Added multi-round support)
          "standings": {
            "rankingMetric": "points",
            "sortDirection": "desc",
            "tieBreakers": [
              {
                "rankingMetric": "current_round_firsts",
                "sortDirection": "desc"
              },
              {
                "rankingMetric": "round_entry_seed",
                "sortDirection": "asc"
              }
            ]
          },
          "reseedStandings": {
            "rankingMetric": "tournament_points",
            "sortDirection": "desc",
            "tieBreakers": [
              {
                "rankingMetric": "current_round_firsts",
                "sortDirection": "desc"
              },
              {
                "rankingMetric": "round_entry_seed",
                "sortDirection": "asc"
              }
            ]
          },
          "winCondition": {
            "type": "highest_points_after_games",
            "games": 2,
            "rankingMetric": "points"
          }
        }
      ]
    }
    $format$::jsonb,
    null,
    null,
    seeded_at,
    seeded_at
  )
  returning id into seed_tournament_id;

  insert into public.tournament_registrations (
    tournament_id,
    registration_status,
    display_name,
    riot_puuid,
    created_at,
    updated_at
  )
  select
    seed_tournament_id,
    'registered',
    leaderboard.display_name,
    null,
    seeded_at + leaderboard.rank * interval '1 second',
    seeded_at + leaderboard.rank * interval '1 second'
  from (
    values
      (1, 'FuuTime#xdd'),
      (2, 'ffstars#8787'),
      (3, 'ทนายPong#1244'),
      (4, 'FS Foeman#bundd'),
      (5, 'Kathrina Irene#tin'),
      (6, 'ZzzTina#SEA'),
      (7, 'Braven#ph2'),
      (8, 'Dodes#MD3'),
      (9, 'Houston3001#9594'),
      (10, 'TTVBubu1150#qquer'),
      (11, 'k4yj#7914'),
      (12, 'cjwei98#cjw98'),
      (13, 'Havok#BEE'),
      (14, 'freezingfiref#SG2'),
      (15, 'teennn#TH22'),
      (16, 'PunNyไง#lnwza'),
      (17, 'kitai#0801'),
      (18, 'TS jose#1023'),
      (19, 'HERTA#127'),
      (20, 'ZeroNXD#xdx'),
      (21, 'TaNTaNCE#3443'),
      (22, 'TS Stryggar#004'),
      (23, 'Sugappy#ooo'),
      (24, 'mashimomo#971'),
      (25, 'outboxer009#333'),
      (26, 'Dubu#2227'),
      (27, 'AXM Juswa Garcia#AXM'),
      (28, 'sayy35#1622'),
      (29, 'luluinblue#1008'),
      (30, 'Player 5#0111'),
      (31, 'AXM Maha#TFT'),
      (32, 'ScuttleCat#3309'),
      (33, 'TFTmobile#oloGS'),
      (34, 'acheron#hui'),
      (35, 'i love faker#dave'),
      (36, 'Echidna#2333'),
      (37, 'BALANCEZZ#117'),
      (38, 'TTVDude1323#ngum'),
      (39, 'skrh#65656'),
      (40, 'DASIES#AIMER'),
      (41, 'penjamin city#pepe'),
      (42, 'Adeus#1011'),
      (43, 'AXM Vincent#maru'),
      (44, 'ทนายChamp#1221'),
      (45, 'darkdagger#Enryu'),
      (46, 'ADEARTHLH#LHNO1'),
      (47, '蔡徐坤#01121'),
      (48, 'Berlin#sryze'),
      (49, 'OLY Chigu El#Oly'),
      (50, 'JustADonutz#727'),
      (51, '卧槽1#CNM'),
      (52, 'angery#ooo'),
      (53, 'Final Flash#322'),
      (54, 'TS mode#tft'),
      (55, 'Reso#RESO'),
      (56, 'no1 contester#6969'),
      (57, 'TSM Doublelift#tsmd'),
      (58, 'FansIGXNo3#Tammm'),
      (59, 'two thirty nine#239'),
      (60, 'Lil Rhythm#SEA'),
      (61, 'cecalis#zc1'),
      (62, 'flylovetantan28#21423'),
      (63, 'ShadowRealm#SG2'),
      (64, 'borgir#cheez'),
      (65, 'pika#LLL'),
      (66, 'เบาเบา#SEA'),
      (67, 'blackwhite2310#1110'),
      (68, 'bunty991#4685'),
      (69, 'pakorn#5424'),
      (70, 'Leafy#0322'),
      (71, 'FindOut#SG2'),
      (72, 'hoj#011'),
      (73, 'NotRoyce#1103'),
      (74, 'OBE Maple#AYAYA'),
      (75, 'Kureaa#Kirei'),
      (76, 'AlNe#9898'),
      (77, 'TTVBibi1450#shiro'),
      (78, 'JIL#1265'),
      (79, 'AXM Gettey#AXM'),
      (80, 'Nowhere#6286'),
      (81, 'แทน#7502'),
      (82, 'Nottstyle#TFTM'),
      (83, 'Brian477#477'),
      (84, 'Doni#KGAGU'),
      (85, 'maxxine#sleep'),
      (86, 'Xander#4022'),
      (87, 'YutaTFT#1704'),
      (88, 'Intentions#20266'),
      (89, 'Coldbloodleo#3336'),
      (90, 'Eunseo#0111'),
      (91, 'Sumthing#Spoky'),
      (92, 'ghost of a#smile'),
      (93, 'ChristianprddWTF#71101'),
      (94, 'moonlight#信仰27'),
      (95, 'Johan#byou'),
      (96, 'SMIAER#4444'),
      (97, 'Ephraim#4LYF'),
      (98, 'Freek#0611'),
      (99, 'BLACKY2#4444'),
      (100, 'dusk abuser#dev'),
      (101, 'VA Turbo#Beer'),
      (102, 'Jesse#NtHim'),
      (103, 'baterson14#bater'),
      (104, 'MKL Koshiro#0902'),
      (105, 'bigemilywngfan69#OBE'),
      (106, 'YJlnwZa#007'),
      (107, 'Nico Robin#qtqt'),
      (108, 'Jhun#iicy'),
      (109, 'FOND#FFFF'),
      (110, 'underscores#milk'),
      (111, 'Nerumo#7777'),
      (112, 'มะนาวโซบะ#NotYu'),
      (113, 'Rczz#8101'),
      (114, 'DoctoringWho#doc'),
      (115, 'Buahlil1#mbg'),
      (116, 'ราชานรก Reyleigh#7777'),
      (117, 'emile#SG2'),
      (118, 'RisenRampart#RR1'),
      (119, 'BACK2DECEMBER#2705'),
      (120, 'Chicken Tocino#ph2'),
      (121, 'Rozu#4610'),
      (122, 'NickyNick#Nick'),
      (123, 'nitefox23#NA1'),
      (124, 'felidae#8421'),
      (125, 'Imteor3#radio'),
      (126, 'iLuvReze#Reze'),
      (127, 'TofuDonburi#dubu'),
      (128, 'Rochiester#1313')
  ) as leaderboard(rank, display_name)
  order by leaderboard.rank;
end;
$$;
