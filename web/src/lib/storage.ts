import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/config/env";

/**
 * Local file storage (PDFs, payment evidence, deliverables) under STORAGE_DIR.
 * Keys are relative POSIX paths, e.g. "documents/2026/R-2026-0001.pdf".
 * Swap this module for an S3/R2 driver later without touching callers.
 */

export function storageRoot(): string {
  return path.resolve(process.cwd(), env().STORAGE_DIR);
}

const SAFE_SEGMENT = /^[A-Za-z0-9._-]+$/;

export function makeStorageKey(...segments: string[]): string {
  for (const segment of segments) {
    if (!SAFE_SEGMENT.test(segment) || segment === "." || segment === "..") {
      throw new Error(`Unsafe storage key segment: "${segment}"`);
    }
  }
  return segments.join("/");
}

function resolveKey(key: string): string {
  makeStorageKey(...key.split("/"));
  const root = storageRoot();
  const full = path.resolve(root, key);
  if (!full.startsWith(root + path.sep)) throw new Error(`Storage key escapes root: ${key}`);
  return full;
}

export interface StoredObject {
  key: string;
  sha256: string;
  sizeBytes: number;
}

export async function putObject(key: string, data: Uint8Array): Promise<StoredObject> {
  const full = resolveKey(key);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, data, { flag: "wx" });
  return { key, sha256: createHash("sha256").update(data).digest("hex"), sizeBytes: data.byteLength };
}

export async function getObject(key: string): Promise<Buffer> {
  return readFile(resolveKey(key));
}

export async function objectExists(key: string): Promise<boolean> {
  try {
    await stat(resolveKey(key));
    return true;
  } catch {
    return false;
  }
}
