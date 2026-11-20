import { createHash, timingSafeEqual } from 'node:crypto';

export function validServiceToken(header, secret) {
  if (!secret || secret.length < 32 || typeof header !== 'string') return false;
  return timingSafeEqual(createHash('sha256').update(header).digest(), createHash('sha256').update(`Bearer ${secret}`).digest());
}
