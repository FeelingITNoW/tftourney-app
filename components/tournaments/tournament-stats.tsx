type TournamentStatsProps = {
  status: string;
  currentRoundLabel: string;
  formatId: string;
};

// Compact, always-visible stat strip shown above the tournament screen tabs.
// Registered/entrant counts live on the Players screen instead, since those
// numbers only come from the "details" panel fetch and aren't available
// (without a second DB round trip) on every screen.
export function TournamentStats({ status, currentRoundLabel, formatId }: TournamentStatsProps) {
  return (
    <dl className="mt-5 grid gap-3 text-sm sm:grid-cols-3">
      <div className="border-l-4 border-emerald-600 bg-white px-4 py-3 shadow-sm">
        <dt className="text-zinc-500">Status</dt>
        <dd className="mt-1 font-semibold capitalize text-zinc-950">{status.replaceAll("_", " ")}</dd>
      </div>
      <div className="border-l-4 border-zinc-800 bg-white px-4 py-3 shadow-sm">
        <dt className="text-zinc-500">Round</dt>
        <dd className="mt-1 font-semibold text-zinc-950">{currentRoundLabel}</dd>
      </div>
      <div className="border-l-4 border-zinc-300 bg-white px-4 py-3 shadow-sm">
        <dt className="text-zinc-500">Format</dt>
        <dd className="mt-1 font-semibold text-zinc-950">{formatId}</dd>
      </div>
    </dl>
  );
}
