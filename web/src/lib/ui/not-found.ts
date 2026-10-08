import { notFound } from "next/navigation";
import { NotFoundError } from "@/lib/errors";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Route params are untrusted: anything that is not a UUID is a 404, not a DB error. */
export function assertUuid(value: string): void {
  if (!UUID.test(value)) notFound();
}

export async function orNotFound<T>(promise: Promise<T>): Promise<T> {
  try {
    return await promise;
  } catch (err) {
    if (err instanceof NotFoundError) notFound();
    throw err;
  }
}
