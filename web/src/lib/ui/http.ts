/** Download responses for stored files (PDFs, evidence, deliverables). */

const PRIVATE_HEADERS = {
  "Cache-Control": "private, no-store",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
  "Referrer-Policy": "no-referrer",
};

const INLINE_SAFE = new Set(["application/pdf", "image/png", "image/jpeg", "image/webp", "image/gif"]);

const EXTENSION_TYPES: Record<string, string> = {
  pdf: "application/pdf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  zip: "application/zip",
};

export function contentTypeFor(fileName: string, declared?: string | null): string {
  if (declared && declared !== "application/octet-stream") return declared;
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[ext] ?? "application/octet-stream";
}

/** RFC 6266 / 5987 header that keeps Arabic file names intact. */
function contentDisposition(kind: "inline" | "attachment", fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7E]+/g, "_").replace(/["\\]/g, "_") || "file";
  return `${kind}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

export function fileResponse(
  data: Uint8Array,
  options: { fileName: string; contentType?: string | null; inline?: boolean },
): Response {
  const type = contentTypeFor(options.fileName, options.contentType);
  // Only PDFs and images are shown inline; anything else downloads, so an
  // uploaded HTML/SVG file can never run in the app's origin.
  const inline = options.inline !== false && INLINE_SAFE.has(type);
  return new Response(new Uint8Array(data), {
    headers: {
      "Content-Type": type,
      "Content-Length": String(data.byteLength),
      "Content-Disposition": contentDisposition(inline ? "inline" : "attachment", options.fileName),
      "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'; style-src 'unsafe-inline'",
      ...PRIVATE_HEADERS,
    },
  });
}

/** Plain-text error for download routes (never reveals whether the item exists). */
export function deniedResponse(status: 403 | 404 = 404): Response {
  return new Response(status === 404 ? "Not found" : "Forbidden", {
    status,
    headers: { "Content-Type": "text/plain; charset=utf-8", ...PRIVATE_HEADERS },
  });
}

/** Redirect to an external deliverable link without leaking the portal URL. */
export function externalRedirect(url: string): Response {
  return new Response(null, { status: 303, headers: { Location: url, ...PRIVATE_HEADERS } });
}
