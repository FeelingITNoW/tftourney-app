"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { GoogleSheetExportStatus } from "@/lib/sheets/types";

type Props = {
  tournamentId: string;
  authError?: string;
  authSuccess?: boolean;
  initiallyAuthenticated?: boolean;
};

const POLL_DELAYS_MS = [2000, 4000, 8000, 15000, 15000] as const;

const AUTH_ERRORS: Record<string, string> = {
  google_oauth_failed: "Google sign-in could not be completed. Please try again.",
  google_refresh_token_missing: "Google did not grant offline access. Reconnect and approve the requested Drive access.",
  google_token_encryption_missing: "Google Sheets publishing is not fully configured. Set GOOGLE_TOKEN_ENCRYPTION_KEY and restart the app.",
  google_user_failed: "Your Google account details could not be loaded. Please try again.",
  user_profile_failed: "Your organizer profile could not be connected to Google.",
};

export function GoogleSheetsPublishingPanel({
  tournamentId,
  authError,
  authSuccess = false,
  initiallyAuthenticated = false,
}: Props) {
  const [status, setStatus] = useState<GoogleSheetExportStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [needsLogin, setNeedsLogin] = useState(!initiallyAuthenticated);
  const [pollTimedOut, setPollTimedOut] = useState(false);
  const pollTimerRef = useRef<number | null>(null);
  const pollAttemptRef = useRef(0);

  const clearPollTimer = useCallback(() => {
    if (pollTimerRef.current !== null) {
      window.clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }, []);

  const loadStatus = useCallback(async () => {
    const response = await fetch(`/api/tournaments/${encodeURIComponent(tournamentId)}/google-sheets`, { cache: "no-store" });
    const body = (await response.json()) as GoogleSheetExportStatus | { error?: string };
    if (response.status === 401) {
      clearPollTimer();
      setStatus(null);
      setNeedsLogin(true);
      return;
    }
    if (!response.ok) throw new Error("error" in body ? body.error ?? "Sheet status could not be loaded." : "Sheet status could not be loaded.");
    const nextStatus = body as GoogleSheetExportStatus;
    setNeedsLogin(false);
    setStatus(nextStatus);
    if (nextStatus.state !== "queued" && nextStatus.state !== "syncing") {
      pollAttemptRef.current = 0;
      setPollTimedOut(false);
    }
  }, [clearPollTimer, tournamentId]);

  useEffect(() => {
    if (!initiallyAuthenticated) return;
    queueMicrotask(() => {
      void loadStatus().catch(() => setError("Google Sheet status is unavailable."));
    });
    return clearPollTimer;
  }, [clearPollTimer, initiallyAuthenticated, loadStatus]);

  useEffect(() => {
    if (!initiallyAuthenticated || needsLogin || !status || (status.state !== "queued" && status.state !== "syncing")) return;
    const delay = POLL_DELAYS_MS[pollAttemptRef.current];
    if (delay === undefined) {
      setPollTimedOut(true);
      return;
    }
    pollAttemptRef.current += 1;
    const timer = window.setTimeout(() => {
      pollTimerRef.current = null;
      void loadStatus().catch(() => {
        setError("Google Sheet status is unavailable.");
        setPollTimedOut(true);
      });
    }, delay);
    pollTimerRef.current = timer;
    return () => window.clearTimeout(timer);
  }, [initiallyAuthenticated, loadStatus, needsLogin, status]);

  async function queueExport(path: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(path, { method: "POST" });
      const body = (await response.json()) as GoogleSheetExportStatus | { error?: string };
      if (response.status === 401) {
        clearPollTimer();
        setStatus(null);
        setNeedsLogin(true);
        return;
      }
      if (!response.ok) throw new Error("error" in body ? body.error ?? "Sheet export failed." : "Sheet export failed.");
      clearPollTimer();
      pollAttemptRef.current = 0;
      setPollTimedOut(false);
      setNeedsLogin(false);
      setStatus(body as GoogleSheetExportStatus);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Sheet export failed.");
    } finally {
      setBusy(false);
    }
  }

  function refreshStatus() {
    clearPollTimer();
    pollAttemptRef.current = 0;
    setPollTimedOut(false);
    setError("");
    void loadStatus().catch(() => {
      setError("Google Sheet status is unavailable.");
      setPollTimedOut(true);
    });
  }

  const basePath = `/api/tournaments/${encodeURIComponent(tournamentId)}/google-sheets`;
  const stateLabel = needsLogin
    ? "Sign in required"
    : status?.state === "not_created"
      ? "Not generated"
      : status?.state === "needs_reauth"
        ? "Reconnect Google"
        : status?.state ?? "Loading";

  return (
    <section className="rounded-lg border border-indigo-200 bg-indigo-50 p-5 shadow-sm" aria-label="Google Sheets publishing">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-semibold text-indigo-950">Google Sheets scoreboard</h2>
          <p className="mt-1 text-sm text-indigo-900">Players, standard scores, and checkmate standings in one shareable workbook.</p>
        </div>
        <span className="rounded-full bg-white px-3 py-1 text-xs font-semibold uppercase tracking-wide text-indigo-800">{stateLabel}</span>
      </div>
      {status?.lastSyncedAt ? <p className="mt-3 text-xs text-indigo-800">Last synced {new Date(status.lastSyncedAt).toLocaleString()}</p> : null}
      {status?.lastError ? <p className="mt-3 text-sm font-medium text-red-700" role="alert">{status.lastError.message}</p> : null}
      {authSuccess ? <p className="mt-3 text-sm font-medium text-emerald-800" role="status">Google account connected.</p> : null}
      {authError ? <p className="mt-3 text-sm font-medium text-red-700" role="alert">{AUTH_ERRORS[authError] ?? "Google sign-in failed. Please try again."}</p> : null}
      {error ? <p className="mt-3 text-sm font-medium text-red-700" role="alert">{error}</p> : null}
      {needsLogin ? <p className="mt-3 text-sm text-indigo-900">Sign in with Google to create and publish this workbook.</p> : null}
      {pollTimedOut ? <p className="mt-3 text-sm text-indigo-900">The export is still processing. Refresh status to check again.</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        {needsLogin ? <a className="rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-900 hover:bg-indigo-100" href={`/api/auth/google?returnTo=${encodeURIComponent(`/tournaments/${tournamentId}`)}`}>Sign in with Google</a> : null}
        {!needsLogin && status?.spreadsheetUrl ? (
          <a className="rounded-md bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800" href={status.spreadsheetUrl} rel="noreferrer" target="_blank">Open public workbook</a>
        ) : null}
        {!needsLogin ? <button className="rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-900 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy || ((status?.state === "queued" || status?.state === "syncing") && !pollTimedOut)} onClick={() => void queueExport(basePath)} type="button">
          {pollTimedOut && !status?.spreadsheetId ? "Retry generation" : status?.spreadsheetId ? "Publish latest scores" : status?.state === "queued" || status?.state === "syncing" ? "Generating…" : "Generate Google Sheet"}
        </button> : null}
        {!needsLogin && status?.spreadsheetId && status.state !== "queued" && status.state !== "syncing" ? (
          <button className="rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-900 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={() => void queueExport(`${basePath}/sync`)} type="button">Retry sync</button>
        ) : null}
        {!needsLogin && pollTimedOut ? <button className="rounded-md border border-indigo-300 bg-white px-4 py-2 text-sm font-semibold text-indigo-900 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50" disabled={busy} onClick={refreshStatus} type="button">Refresh status</button> : null}
      </div>
    </section>
  );
}
