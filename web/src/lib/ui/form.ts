import { DomainError } from "@/lib/errors";
import { parseMoney, type Currency } from "@/lib/money";

/** Small FormData readers for server actions. Every value is untrusted input. */

export function str(fd: FormData, key: string): string {
  const value = fd.get(key);
  return typeof value === "string" ? value.trim() : "";
}

/** Trimmed string, or null when empty. */
export function optStr(fd: FormData, key: string): string | null {
  return str(fd, key) || null;
}

export function bool(fd: FormData, key: string): boolean {
  const value = fd.get(key);
  return value === "on" || value === "true" || value === "1";
}

export function int(fd: FormData, key: string, fallback = 0): number {
  const raw = str(fd, key);
  if (raw === "") return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n)) throw new DomainError("invalid_input", `${key} must be an integer`, { field: key });
  return n;
}

export function money(fd: FormData, key: string, currency: Currency): number {
  return parseMoney(str(fd, key) || "0", currency);
}

/** One item per non-empty line of a textarea. */
export function lines(fd: FormData, key: string): string[] {
  return str(fd, key)
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function oneOf<T extends string>(fd: FormData, key: string, values: readonly T[], fallback?: T): T {
  const value = str(fd, key);
  if ((values as readonly string[]).includes(value)) return value as T;
  if (fallback !== undefined) return fallback;
  throw new DomainError("invalid_input", `Invalid ${key}`, { field: key });
}

export interface UploadedFile {
  data: Uint8Array;
  fileName: string;
  mimeType: string;
}

export async function file(fd: FormData, key: string): Promise<UploadedFile | null> {
  const value = fd.get(key);
  if (!(value instanceof File) || value.size === 0) return null;
  return {
    data: new Uint8Array(await value.arrayBuffer()),
    fileName: value.name || "file",
    mimeType: value.type || "application/octet-stream",
  };
}
