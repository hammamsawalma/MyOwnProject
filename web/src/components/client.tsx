"use client";

import {
  createContext,
  useActionState,
  useContext,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ComponentProps,
  type FormEvent,
  type ReactNode,
} from "react";
import { IDLE, type ActionState, type FormAction } from "@/lib/ui/action-state";
import { buttonClass, cx, type ButtonSize, type ButtonVariant } from "./ui";

/** Interactive form helpers shared by the admin and the client portal. */

const PendingContext = createContext(false);

export function SubmitButton({
  children,
  variant = "primary",
  size = "md",
  className,
  pendingLabel,
  ...props
}: Omit<ComponentProps<"button">, "type"> & {
  variant?: ButtonVariant;
  size?: ButtonSize;
  pendingLabel?: ReactNode;
}) {
  const pending = useContext(PendingContext);
  return (
    <button
      type="submit"
      disabled={pending || props.disabled}
      aria-busy={pending}
      className={buttonClass(variant, size, className)}
      {...props}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

export function FormMessage({ state }: { state: ActionState }) {
  if (state.status === "idle" || (state.status === "ok" && !state.message)) return null;
  const isError = state.status === "error";
  return (
    <p role={isError ? "alert" : "status"} className={cx("text-sm", isError ? "text-danger" : "text-success")}>
      {state.message}
    </p>
  );
}

/**
 * A form bound to a server action through useActionState. Submits via a
 * transition (instead of the form `action` prop) so inputs are not cleared
 * when the server returns a validation error.
 */
export function ActionForm({
  action,
  children,
  className,
  confirm,
  resetOnSuccess = false,
  onResult,
  messageClassName,
  hideMessage = false,
}: {
  action: FormAction;
  children: ReactNode | ((state: ActionState) => ReactNode);
  className?: string;
  /** Asks for confirmation before submitting. */
  confirm?: string;
  resetOnSuccess?: boolean;
  onResult?: (state: ActionState) => void;
  messageClassName?: string;
  hideMessage?: boolean;
}) {
  const [state, dispatch, pending] = useActionState(action, IDLE);
  const [, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (state.status === "idle") return;
    if (state.status === "ok" && resetOnSuccess) formRef.current?.reset();
    onResult?.(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per new result
  }, [state]);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (confirm && !window.confirm(confirm)) return;
    const submitter = (event.nativeEvent as SubmitEvent).submitter;
    const formData = new FormData(event.currentTarget, submitter);
    startTransition(() => dispatch(formData));
  }

  return (
    <PendingContext.Provider value={pending}>
      <form ref={formRef} onSubmit={onSubmit} className={className}>
        {typeof children === "function" ? children(state) : children}
        {!hideMessage && (
          <div className={cx("empty:hidden", messageClassName)}>
            <FormMessage state={state} />
          </div>
        )}
      </form>
    </PendingContext.Provider>
  );
}

export function CopyButton({
  value,
  label,
  copiedLabel,
  className,
}: {
  value: string;
  label: string;
  copiedLabel: string;
  className?: string;
}) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      const input = document.createElement("textarea");
      input.value = value;
      document.body.appendChild(input);
      input.select();
      document.execCommand("copy");
      input.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }
  return (
    <button type="button" onClick={copy} className={buttonClass("secondary", "sm", className)}>
      {copied ? copiedLabel : label}
    </button>
  );
}
