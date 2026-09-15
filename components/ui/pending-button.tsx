"use client";

import type { ReactNode } from "react";
import { useFormStatus } from "react-dom";

type PendingButtonProps = {
  children: ReactNode;
  pendingLabel: ReactNode;
  className: string;
  disabled?: boolean;
  /** When set, asks for confirmation before the form submits. */
  confirmMessage?: string;
};

/**
 * Submit button for a server-action `<form>` that shows visible feedback
 * while the action is in flight, instead of appearing to do nothing until
 * the page navigates. Must be rendered inside the `<form>` it submits --
 * useFormStatus only reports the nearest ancestor form.
 */
export function PendingButton({ children, pendingLabel, className, disabled, confirmMessage }: PendingButtonProps) {
  const { pending } = useFormStatus();
  return (
    <button
      className={className}
      disabled={disabled || pending}
      onClick={
        confirmMessage
          ? (event) => {
              if (!window.confirm(confirmMessage)) event.preventDefault();
            }
          : undefined
      }
      type="submit"
    >
      {pending ? pendingLabel : children}
    </button>
  );
}
