import { createTournamentAction } from "@/app/actions";
import { TOURNAMENT_FORMAT_OPTIONS } from "@/lib/tournament/formats/api";
import { PLAYERS_PER_TFT_LOBBY } from "@/lib/tournament/validation/api";
import type { TournamentCreationValidation } from "@/lib/tournament/validation/types";

type QuickCreateFormProps = {
  tournamentName: string;
  playerCount: string;
  formatId: string;
  validation: TournamentCreationValidation | null;
  createError: string;
};

export function QuickCreateForm({
  tournamentName,
  playerCount,
  formatId,
  validation,
  createError,
}: QuickCreateFormProps) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="border-b border-zinc-200 pb-5">
        <h2 className="text-xl font-semibold text-zinc-950">Tournament details</h2>
        <p className="mt-1 text-sm text-zinc-500">
          Fill in the fields needed to save a tournament draft.
        </p>
      </div>

      <form action={createTournamentAction} className="mt-6 space-y-5">
        <div>
          <label className="block text-sm font-medium text-zinc-800" htmlFor="tournamentName">
            Tournament name
          </label>
          <input
            aria-describedby={validation?.errors.name ? "tournamentName-error" : "tournamentName-help"}
            aria-invalid={Boolean(validation?.errors.name)}
            className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
            defaultValue={tournamentName}
            id="tournamentName"
            maxLength={80}
            name="tournamentName"
            placeholder="Friday TFT Open"
            required
            type="text"
          />
          {validation?.errors.name ? (
            <p className="mt-2 text-sm font-medium text-red-700" id="tournamentName-error">
              {validation.errors.name}
            </p>
          ) : (
            <p className="mt-2 text-sm text-zinc-500" id="tournamentName-help">
              3-80 characters. Start with a letter or number.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-800" htmlFor="playerCount">
            Number of players
          </label>
          <input
            aria-describedby={validation?.errors.playerCount ? "playerCount-error" : "playerCount-help"}
            aria-invalid={Boolean(validation?.errors.playerCount)}
            className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
            defaultValue={playerCount}
            id="playerCount"
            inputMode="numeric"
            max={512}
            min={8}
            name="playerCount"
            placeholder="32"
            required
            step={8}
            type="number"
          />
          {validation?.errors.playerCount ? (
            <p className="mt-2 text-sm font-medium text-red-700" id="playerCount-error">
              {validation.errors.playerCount}
            </p>
          ) : (
            <p className="mt-2 text-sm text-zinc-500" id="playerCount-help">
              Must divide exactly into 8-player TFT lobbies.
            </p>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-zinc-800" htmlFor="formatId">
            Tournament format
          </label>
          <select
            aria-describedby="formatId-help"
            className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
            defaultValue={formatId}
            id="formatId"
            name="formatId"
          >
            {TOURNAMENT_FORMAT_OPTIONS.map((format) => (
              <option key={format.id} value={format.id}>
                {format.name}
              </option>
            ))}
          </select>
          <p className="mt-2 text-sm text-zinc-500" id="formatId-help">
            The default format is selected for now.
          </p>
        </div>

        <button
          className="flex h-11 w-full items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
          type="submit"
        >
          Create tournament
        </button>
      </form>

      {createError ? (
        <div className="mt-6 rounded-md border border-red-200 bg-red-50 p-4">
          <p className="text-sm font-semibold text-red-900">Tournament was not created</p>
          <p className="mt-2 text-sm text-red-800">{createError}</p>
        </div>
      ) : null}

      {validation?.success ? (
        <div className="mt-6 rounded-md border border-emerald-200 bg-emerald-50 p-4">
          <p className="text-sm font-semibold text-emerald-900">Tournament details are valid</p>
          <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-emerald-700">Name</dt>
              <dd className="mt-1 font-medium text-emerald-950">{validation.data.name}</dd>
            </div>
            <div>
              <dt className="text-emerald-700">Opening lobbies</dt>
              <dd className="mt-1 font-medium text-emerald-950">
                {validation.data.playerCount / PLAYERS_PER_TFT_LOBBY}
              </dd>
            </div>
          </dl>
        </div>
      ) : null}
    </div>
  );
}
