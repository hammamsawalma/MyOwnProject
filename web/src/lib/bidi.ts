/**
 * Wraps a left-to-right fragment (amount, document ref, email) in Unicode
 * isolates (LRI ... PDI) so it keeps its internal order inside Arabic text
 * (e.g. "400.00 USD", "Q-2026-0001") and does not pull neighbouring punctuation
 * along. Use it for plain strings; in JSX prefer <bdi dir="ltr">.
 */
export function ltr(fragment: string): string {
  return `\u2066${fragment}\u2069`;
}

/**
 * Isolates text whose direction is unknown (e.g. a client's name, Arabic or
 * Latin) with FSI ... PDI, so it neither reorders nor disturbs the sentence.
 */
export function isolate(text: string): string {
  return `\u2068${text}\u2069`;
}
