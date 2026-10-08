/** Errors the UI can map to a user-facing message via `code`. */
export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export class NotFoundError extends DomainError {
  constructor(entity: string, id: string) {
    super("not_found", `${entity} ${id} not found`, { entity, id });
    this.name = "NotFoundError";
  }
}
