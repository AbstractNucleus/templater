/** Last path segment, handling both `/` and `\` separators. Returns the input
 *  unchanged when it contains no separator. */
export function basename(p: string): string {
  const m = p.match(/[^\\/]+$/);
  return m ? m[0] : p;
}
