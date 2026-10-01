import { DeleteTournamentModal } from "@/components/tournaments/delete-tournament-modal";

type SettingsScreenProps = {
  tournamentId: string;
  isTournamentHost: boolean;
  deleteError: string;
  defaultOpenDeleteModal: boolean;
};

// Shared Settings screen (currently just the danger zone). Used by both the
// pre-start and started layouts.
export function SettingsScreen({ tournamentId, isTournamentHost, deleteError, defaultOpenDeleteModal }: SettingsScreenProps) {
  return (
    <div className="pt-6">
      <div className="max-w-xl rounded-lg border border-red-200 bg-red-50 p-5 shadow-sm">
        <h2 className="text-lg font-semibold text-red-950">Delete tournament</h2>
        <p className="mt-2 text-sm text-red-800">
          Permanently deletes this tournament, all registrations, rounds, lobbies, participants, and scores.
        </p>
        <div className="mt-4">
          <DeleteTournamentModal
            defaultOpen={defaultOpenDeleteModal}
            deleteError={deleteError}
            isHost={isTournamentHost}
            tournamentId={tournamentId}
          />
        </div>
      </div>
    </div>
  );
}
