import { createHash } from "node:crypto";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "@/config/env";

/**
 * File storage (PDFs, payment evidence, deliverables). Keys are relative POSIX
 * paths, e.g. "documents/2026/R-2026-0001_<id>.pdf". Callers only use the
 * functions at the bottom; adding R2/S3 later means writing another
 * StorageDriver and returning it from storageDriver().
 */

export interface StoredObject {
  key: string;
  sha256: string;
  sizeBytes: number;
}

export interface StorageDriver {
  /** Writes a new object; must fail if the key already exists (objects are write-once). */
  put(key: string, data: Uint8Array): Promise<StoredObject>;
  get(key: string): Promise<Buffer>;
  exists(key: string): Promise<boolean>;
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

export function storageRoot(): string {
  return path.resolve(process.cwd(), env().STORAGE_DIR);
}

/** Local disk under STORAGE_DIR (development and single-server deployments). */
export function localDiskDriver(root: string = storageRoot()): StorageDriver {
  const resolveKey = (key: string): string => {
    makeStorageKey(...key.split("/"));
    const full = path.resolve(root, key);
    if (!full.startsWith(root + path.sep)) throw new Error(`Storage key escapes root: ${key}`);
    return full;
  };
  return {
    async put(key, data) {
      const full = resolveKey(key);
      await mkdir(path.dirname(full), { recursive: true });
      await writeFile(full, data, { flag: "wx" });
      return { key, sha256: createHash("sha256").update(data).digest("hex"), sizeBytes: data.byteLength };
    },
    get(key) {
      return readFile(resolveKey(key));
    },
    async exists(key) {
      try {
        await stat(resolveKey(key));
        return true;
      } catch {
        return false;
      }
    },
  };
}

export function storageDriver(): StorageDriver {
  return localDiskDriver();
}

export function putObject(key: string, data: Uint8Array): Promise<StoredObject> {
  return storageDriver().put(key, data);
}

export function getObject(key: string): Promise<Buffer> {
  return storageDriver().get(key);
}

export function objectExists(key: string): Promise<boolean> {
  return storageDriver().exists(key);
}

/** Last path segment of a key, for download file names. */
export function storageKeyFileName(key: string): string {
  return key.split("/").pop() ?? "file";
}
