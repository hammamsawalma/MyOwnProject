/** Result of a form server action, consumed by useActionState on the client. */
export type ActionState =
  | { status: "idle" }
  | { status: "ok"; message?: string; data?: Record<string, string> }
  | { status: "error"; message: string };

export const IDLE: ActionState = { status: "idle" };

export type FormAction = (prev: ActionState, formData: FormData) => Promise<ActionState>;
