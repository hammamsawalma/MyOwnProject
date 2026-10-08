/**
 * Wraps a left-to-right fragment (amount, document ref, email) in Unicode
 * isolates (LRI ... PDI) so it keeps its order inside Arabic text, e.g.
 * "استلمنا دفعة بقيمة 400.00 US$" instead of "$US 400.00". Use it for plain
 * strings; in JSX prefer <bdi dir="ltr">.
 */
export function ltr(fragment: string): string {
  return `⁦${fragment}⁩`;
}
