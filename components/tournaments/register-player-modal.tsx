import { registerPlayerAction } from "@/app/actions";
import { Modal } from "@/components/ui/modal";

type RegisterPlayerModalProps = {
  tournamentId: string;
  isHost: boolean;
  registrationError: string;
  defaultOpen: boolean;
};

export function RegisterPlayerModal({ tournamentId, isHost, registrationError, defaultOpen }: RegisterPlayerModalProps) {
  return (
    <Modal
      defaultOpen={defaultOpen}
      title="Register player"
      triggerClassName="inline-flex h-10 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
      triggerDisabled={!isHost}
      triggerLabel="Register player"
    >
      <form action={registerPlayerAction} className="space-y-4">
        <input name="tournamentId" type="hidden" value={tournamentId} />
        <div>
          <label className="block text-sm font-medium text-zinc-800" htmlFor="gameTag">
            Riot ID
          </label>
          <input
            className="mt-2 h-11 w-full rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
            id="gameTag"
            maxLength={80}
            name="gameTag"
            placeholder="GameName#TAG"
            required
            type="text"
          />
        </div>
        <button
          className="flex h-11 w-full items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2"
          type="submit"
        >
          Verify and register player
        </button>
        {registrationError ? (
          <p className="text-sm font-medium text-red-700" role="alert">
            {registrationError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
