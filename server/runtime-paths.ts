import { fileURLToPath } from 'node:url';

/** Source server/ and built server-dist/ are both direct package children.
 * Server chunks stay flat so worker and resource URLs remain package-relative.
 */
export function runtimeResourcePath(relative: string): string {
  return fileURLToPath(new URL(`../${relative}`, import.meta.url));
}
