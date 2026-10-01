"use client";

import { useEffect, useId, useRef } from "react";
import type { ReactNode } from "react";

type ModalProps = {
  triggerLabel: string;
  triggerClassName?: string;
  triggerDisabled?: boolean;
  title: string;
  children: ReactNode;
  /** Reopens the modal on mount, e.g. when the server redirected back here after a failed submit. */
  defaultOpen?: boolean;
};

const DEFAULT_TRIGGER_CLASSNAME =
  "flex h-11 items-center justify-center rounded-md bg-zinc-950 px-4 text-sm font-semibold text-white transition hover:bg-zinc-800 focus:outline-none focus:ring-2 focus:ring-emerald-600 focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50";

/**
 * Shared modal shell built on the native <dialog> element: showModal() gives
 * focus trapping, Esc-to-close, and the backdrop for free. Children are
 * server-rendered content (often a server-action <form>) passed straight
 * through -- this component only owns open/close state.
 */
export function Modal({
  triggerLabel,
  triggerClassName,
  triggerDisabled,
  title,
  children,
  defaultOpen,
}: ModalProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    if (defaultOpen && !dialogRef.current?.open) {
      dialogRef.current?.showModal();
    }
    // Only ever auto-open once per mount, from the server-provided flag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <button
        className={triggerClassName ?? DEFAULT_TRIGGER_CLASSNAME}
        disabled={triggerDisabled}
        onClick={() => dialogRef.current?.showModal()}
        type="button"
      >
        {triggerLabel}
      </button>
      <dialog
        aria-labelledby={titleId}
        className="w-[calc(100%-2rem)] max-w-lg rounded-xl border border-zinc-200 bg-white p-0 shadow-xl backdrop:bg-zinc-950/40"
        ref={dialogRef}
      >
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-4">
          <h2 className="text-lg font-semibold text-zinc-950" id={titleId}>
            {title}
          </h2>
          <button
            aria-label={`Close ${title}`}
            className="flex h-8 w-8 items-center justify-center rounded-md text-zinc-500 transition hover:bg-zinc-100 hover:text-zinc-900 focus:outline-none focus:ring-2 focus:ring-emerald-600"
            onClick={() => dialogRef.current?.close()}
            type="button"
          >
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto px-5 py-5">{children}</div>
      </dialog>
    </>
  );
}
