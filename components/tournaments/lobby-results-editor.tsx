"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { updateLobbyScoresAction } from "@/app/actions";
import { RandomizeLobbyScoresButton } from "./randomize-lobby-scores-button";
import type { TournamentLobbyParticipant } from "@/lib/db/tournaments/types";
import type { PlacementParseResult } from "@/lib/ocr/placements/types";

type LobbyResultsEditorProps = {
  tournamentId: string;
  lobbyId: string;
  roundId: string;
  returnGame: string;
  returnPage: string;
  backHref: string;
  participants: TournamentLobbyParticipant[];
  roundScoresByParticipantId: Record<string, number>;
  isReadOnly: boolean;
};

function initialPlacements(participants: TournamentLobbyParticipant[]): Record<string, string> {
  return Object.fromEntries(
    participants.map((participant) => [participant.id, participant.placement?.toString() ?? ""]),
  );
}

export function LobbyResultsEditor({
  tournamentId,
  lobbyId,
  roundId,
  returnGame,
  returnPage,
  backHref,
  participants,
  roundScoresByParticipantId,
  isReadOnly,
}: LobbyResultsEditorProps) {
  const [placements, setPlacements] = useState(() => initialPlacements(participants));
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [parsing, setParsing] = useState(false);
  const [parseError, setParseError] = useState("");
  const [parseResult, setParseResult] = useState<PlacementParseResult | null>(null);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  function updatePlacement(participantId: string, value: string) {
    setPlacements((current) => ({ ...current, [participantId]: value }));
  }

  async function parseScreenshot() {
    if (!selectedFile || isReadOnly) return;
    setParsing(true);
    setParseError("");
    setParseResult(null);
    const data = new FormData();
    data.append("image", selectedFile);
    data.append("tournamentId", tournamentId);
    data.append("lobbyId", lobbyId);

    try {
      const response = await fetch("/api/ocr/placements", { method: "POST", body: data });
      const body = (await response.json()) as Partial<PlacementParseResult> & { error?: string };
      const result = body.schemaVersion === 2 && Array.isArray(body.placements) && Array.isArray(body.issues) && body.debug
        ? body as PlacementParseResult
        : null;
      if (result) setParseResult(result);
      if (!response.ok) {
        setParseError(body.error ?? "The screenshot could not be parsed.");
        return;
      }
      if (!result) {
        setParseError("The OCR service returned an invalid response.");
        return;
      }
      const matchedPlacements = new Map(
        result.placements
          .filter((row) => row.matchStatus === "matched" && row.matchedRosterEntry)
          .map((row) => [row.matchedRosterEntry!.id, String(row.placement)]),
      );
      setPlacements((current) => {
        const next = { ...current };
        for (const [participantId, placement] of matchedPlacements) next[participantId] = placement;
        return next;
      });
    } catch {
      setParseError("The screenshot could not be sent for OCR.");
    } finally {
      setParsing(false);
    }
  }

  return (
    <>
      <div className="mt-5 rounded-lg border border-sky-200 bg-sky-50 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h3 className="text-sm font-semibold text-sky-950">Prefill from screenshot</h3>
            <p className="mt-1 text-sm text-sky-900">
              Upload a TFT results screen to suggest placements. The image is sent to Google Cloud Vision and is not saved.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <label className={`flex h-10 cursor-pointer items-center rounded-md border border-sky-300 bg-white px-4 text-sm font-semibold text-sky-900 hover:bg-sky-100 ${isReadOnly ? "cursor-not-allowed opacity-50" : ""}`}>
              Choose image
              <input
                accept="image/png,image/jpeg,image/webp"
                className="sr-only"
                disabled={isReadOnly}
                onChange={(event) => {
                  const nextFile = event.target.files?.[0] ?? null;
                  setSelectedFile(nextFile);
                  setPreviewUrl(nextFile ? URL.createObjectURL(nextFile) : null);
                }}
                type="file"
              />
            </label>
            <button
              className="h-10 rounded-md bg-sky-700 px-4 text-sm font-semibold text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:bg-sky-300"
              disabled={!selectedFile || parsing || isReadOnly}
              onClick={parseScreenshot}
              type="button"
            >
              {parsing ? "Parsing…" : "Parse placements"}
            </button>
          </div>
        </div>
        {selectedFile ? <p className="mt-2 text-xs text-sky-800">Selected: {selectedFile.name}</p> : null}
        {previewUrl ? (
          // Blob URLs cannot be passed through next/image's optimizer.
          // eslint-disable-next-line @next/next/no-img-element
          <img alt="Selected TFT results screenshot preview" className="mt-3 max-h-48 rounded border border-sky-200 object-contain" src={previewUrl} />
        ) : null}
        {parseError ? <p className="mt-3 text-sm font-medium text-red-700" role="alert">{parseError}</p> : null}
        {parseResult ? (
          <div className="mt-3 text-sm text-sky-950" role="status">
            <p className="font-semibold">
              {parseResult.status === "complete" ? "All placements matched. Review them below before saving." : "Some placements need review before saving."}
            </p>
            {parseResult.issues.length ? (
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sky-900">
                {parseResult.issues.map((issue, index) => <li key={`${issue.code}-${issue.placement ?? index}`}>{issue.message}</li>)}
              </ul>
            ) : null}
            <details className="mt-3 rounded border border-sky-200 bg-white p-3 text-xs">
              <summary className="cursor-pointer font-semibold">OCR debug trace</summary>
              <p className="mt-2">
                Strategy: {parseResult.strategy}. Roster supplied: {parseResult.debug.rosterProvided ? `yes (${parseResult.debug.rosterSize})` : "no"}.
                Profile: {parseResult.debug.selectedProfile}. Layout confidence: {parseResult.debug.layoutConfidence.toFixed(2)}. Rank anchors detected: {parseResult.debug.rankAnchors.length}.
              </p>
              <p className="mt-3 font-semibold">Detected OCR words</p>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-zinc-950 p-2 text-zinc-100">
                {parseResult.debug.detectedWords.map((word) => {
                  const x = ((word.box.left + word.box.right) / 2).toFixed(3);
                  const y = ((word.box.top + word.box.bottom) / 2).toFixed(3);
                  return `${word.text} [x=${x}, y=${y}]`;
                }).join("\n")}
              </pre>
              <p className="mt-3 font-semibold">Top-to-bottom name candidates</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                {parseResult.debug.orderedNameCandidates.map((name, index) => <li key={`${index}-${name}`}>{name}</li>)}
              </ol>
              <p className="mt-3 font-semibold">Finalized ordering</p>
              <ol className="mt-1 list-decimal space-y-1 pl-5">
                {parseResult.debug.finalizedOrder.map((row) => <li key={`${row.placement}-${row.extractedName}`}>{row.extractedName || "(empty)"}</li>)}
              </ol>
            </details>
          </div>
        ) : null}
      </div>

      <form action={updateLobbyScoresAction} className="mt-5">
        <input name="tournamentId" type="hidden" value={tournamentId} />
        <input name="lobbyId" type="hidden" value={lobbyId} />
        <input name="returnGame" type="hidden" value={returnGame} />
        <input name="returnPage" type="hidden" value={returnPage} />
        <input name="returnNode" type="hidden" value={roundId} />
        <div className="overflow-x-auto rounded-lg border border-zinc-200 bg-white shadow-sm">
          <table className="w-full min-w-[32rem] border-collapse text-left text-sm">
            <thead className="bg-zinc-50 text-zinc-600">
              <tr>
                <th className="w-20 px-4 py-3 font-medium">Slot</th>
                <th className="px-4 py-3 font-medium">Player</th>
                <th className="w-32 px-4 py-3 font-medium">Placement</th>
                <th className="w-32 px-4 py-3 font-medium">Round total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {participants.map((participant) => (
                <tr key={participant.id}>
                  <td className="px-4 py-3 text-zinc-500">{participant.slotNumber}</td>
                  <td className="px-4 py-3 font-medium text-zinc-950">
                    {participant.displayName}
                    <input name="participantId" type="hidden" value={participant.id} />
                  </td>
                  <td className="px-4 py-3">
                    <label className="sr-only" htmlFor={`placement-${participant.id}`}>Placement for {participant.displayName}</label>
                    <input
                      className="h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-base text-zinc-950 outline-none transition focus:border-emerald-700 focus:ring-2 focus:ring-emerald-100"
                      disabled={isReadOnly}
                      id={`placement-${participant.id}`}
                      max={participants.length}
                      min={1}
                      name="placement"
                      onChange={(event) => updatePlacement(participant.id, event.target.value)}
                      placeholder="1"
                      required
                      step={1}
                      type="number"
                      value={placements[participant.id] ?? ""}
                    />
                  </td>
                  <td className="px-4 py-3 font-semibold text-zinc-950">{roundScoresByParticipantId[participant.id] ?? 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mt-5 flex flex-col-reverse gap-3 sm:flex-row sm:items-center sm:justify-end">
          <Link className="flex h-11 items-center justify-center rounded-md border border-zinc-300 bg-white px-5 text-sm font-semibold text-zinc-700 transition hover:bg-zinc-50" href={backHref}>Cancel</Link>
          <RandomizeLobbyScoresButton disabled={isReadOnly} />
          <button className="flex h-11 items-center justify-center rounded-md bg-emerald-700 px-5 text-sm font-semibold text-white transition hover:bg-emerald-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:bg-zinc-300 disabled:text-zinc-500" disabled={isReadOnly} type="submit">Save lobby results</button>
        </div>
      </form>
    </>
  );
}
