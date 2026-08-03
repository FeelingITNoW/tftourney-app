import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

type Params = Promise<{ tournamentId: string }>;

export default async function CurrentRoundPage({ params }: { params: Params }) {
  const { tournamentId } = await params;
  redirect(`/tournaments/${encodeURIComponent(tournamentId)}`);
}
