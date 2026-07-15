-- WARNING: This schema is for context only and is not meant to be run.
-- The live database currently uses bigint identity keys for tournaments,
-- registrations, rounds, and lobbies. Participant and score records use uuid.

CREATE TABLE public.users (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  email character varying NOT NULL UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT users_pkey PRIMARY KEY (id)
);

CREATE TABLE public.tournaments (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  host_user_id bigint NOT NULL,
  name character varying NOT NULL,
  status character varying NOT NULL DEFAULT 'accepting_players'
    CHECK (status IN ('accepting_players', 'in_progress', 'completed', 'cancelled')),
  max_players integer NOT NULL CHECK (max_players > 0),
  format_config jsonb NOT NULL DEFAULT '{}'::jsonb,
  format_id text NOT NULL DEFAULT 'default',
  current_round_id bigint,
  started_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournaments_pkey PRIMARY KEY (id),
  CONSTRAINT tournaments_current_round_id_fkey
    FOREIGN KEY (current_round_id) REFERENCES public.rounds(id) ON DELETE SET NULL
);

CREATE TABLE public.tournament_registrations (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  tournament_id bigint NOT NULL,
  registration_status character varying NOT NULL DEFAULT 'registered'
    CHECK (registration_status IN ('registered', 'waitlisted', 'entered', 'withdrawn')),
  display_name text NOT NULL,
  riot_puuid text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_registrations_pkey PRIMARY KEY (id),
  CONSTRAINT tournament_registrations_tournament_id_fkey
    FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE
);

CREATE TABLE public.rounds (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  tournament_id bigint NOT NULL,
  round_number integer NOT NULL CHECK (round_number > 0),
  format_round_id text,
  stage_name character varying,
  status character varying NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'active', 'completed', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rounds_pkey PRIMARY KEY (id),
  CONSTRAINT rounds_tournament_id_fkey
    FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE
);

CREATE TABLE public.tournament_participants (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  tournament_id bigint NOT NULL,
  registration_id bigint NOT NULL,
  seed_number integer NOT NULL CHECK (seed_number > 0),
  display_name_at_start text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT tournament_participants_pkey PRIMARY KEY (id),
  CONSTRAINT tournament_participants_tournament_id_fkey
    FOREIGN KEY (tournament_id) REFERENCES public.tournaments(id) ON DELETE CASCADE,
  CONSTRAINT tournament_participants_registration_tournament_fk
    FOREIGN KEY (registration_id, tournament_id)
    REFERENCES public.tournament_registrations(id, tournament_id) ON DELETE CASCADE
);

CREATE TABLE public.lobbies (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  round_id bigint NOT NULL,
  lobby_number integer NOT NULL CHECK (lobby_number > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lobbies_pkey PRIMARY KEY (id),
  CONSTRAINT lobbies_round_id_fkey
    FOREIGN KEY (round_id) REFERENCES public.rounds(id) ON DELETE CASCADE
);

CREATE TABLE public.lobby_participants (
  id bigint GENERATED ALWAYS AS IDENTITY NOT NULL,
  lobby_id bigint NOT NULL,
  participant_id uuid NOT NULL,
  slot_number integer CHECK (slot_number IS NULL OR slot_number > 0),
  placement integer CHECK (placement IS NULL OR placement > 0),
  points integer CHECK (points IS NULL OR points >= 0),
  result_status character varying NOT NULL DEFAULT 'pending'
    CHECK (result_status IN ('pending', 'confirmed', 'corrected', 'disputed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT lobby_participants_pkey PRIMARY KEY (id),
  CONSTRAINT lobby_participants_lobby_id_fkey
    FOREIGN KEY (lobby_id) REFERENCES public.lobbies(id) ON DELETE CASCADE,
  CONSTRAINT lobby_participants_participant_fk
    FOREIGN KEY (participant_id) REFERENCES public.tournament_participants(id)
    ON DELETE CASCADE
);

CREATE TABLE public.participant_round_scores (
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL,
  round_id bigint NOT NULL,
  score integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT participant_round_scores_pkey PRIMARY KEY (id),
  CONSTRAINT participant_round_scores_round_fk
    FOREIGN KEY (round_id) REFERENCES public.rounds(id) ON DELETE CASCADE,
  CONSTRAINT participant_round_scores_participant_fk
    FOREIGN KEY (participant_id) REFERENCES public.tournament_participants(id)
    ON DELETE CASCADE
);

-- Important unique indexes:
-- tournament_registrations(tournament_id, riot_puuid) where riot_puuid is not null
-- tournament_participants(tournament_id, registration_id)
-- tournament_participants(tournament_id, seed_number)
-- rounds(tournament_id, round_number)
-- lobbies(round_id, lobby_number)
-- lobby_participants(lobby_id, participant_id)
-- participant_round_scores(participant_id, round_id)
