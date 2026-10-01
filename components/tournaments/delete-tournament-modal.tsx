import { deleteTournamentAction } from "@/app/actions";
import { Modal } from "@/components/ui/modal";

type DeleteTournamentModalProps = {
  tournamentId: string;
  isHost: boolean;
  deleteError: string;
  defaultOpen: boolean;
};

export function DeleteTournamentModal({ tournamentId, isHost, deleteError, defaultOpen }: DeleteTournamentModalProps) {
  return (
    <Modal
      defaultOpen={defaultOpen}
      title="Delete tournament"
      triggerClassName="flex h-11 items-center justify-center rounded-md bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      triggerDisabled={!isHost}
      triggerLabel="Delete tournament"
    >
      <p className="text-sm text-red-800">
        Permanently deletes this tournament, all registrations, rounds, lobbies, participants, and scores.
      </p>
      <form action={deleteTournamentAction} className="mt-4 space-y-4">
        <input name="tournamentId" type="hidden" value={tournamentId} />
        <div>
          <label className="block text-sm font-medium text-red-950" htmlFor="deleteConfirmation">
            Type DELETE to confirm
          </label>
          <input
            autoComplete="off"
            className="mt-2 h-11 w-full rounded-md border border-red-300 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-red-700 focus:ring-2 focus:ring-red-100"
            id="deleteConfirmation"
            name="deleteConfirmation"
            pattern="DELETE"
            placeholder="DELETE"
            required
            spellCheck={false}
            type="text"
          />
        </div>
        <button
          className="flex h-11 w-full items-center justify-center rounded-md bg-red-700 px-4 text-sm font-semibold text-white transition hover:bg-red-800 focus:outline-none focus:ring-2 focus:ring-red-600 focus:ring-offset-2"
          type="submit"
        >
          Delete tournament permanently
        </button>
        {deleteError ? (
          <p className="text-sm font-medium text-red-800" role="alert">
            {deleteError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
