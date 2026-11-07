import {createHash} from 'node:crypto';
export function digest(parts) {
  return createHash('sha256').update(parts.join('')).digest('hex');
}
