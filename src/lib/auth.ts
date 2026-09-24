import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';

const COOKIE = 'dpdai_session';
const MAX_AGE = 60 * 60 * 24 * 30; // 30 gun

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET ?? '';
  if (s.length < 32) throw new Error('AUTH_SECRET en az 32 karakter olmali (.env).');
  return new TextEncoder().encode(s);
}

// ------------------------------------------------------------------ sifre

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `scrypt:${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [algo, salt, hash] = stored.split(':');
  if (algo !== 'scrypt' || !salt || !hash) return false;
  const candidate = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

// ------------------------------------------------------------------ oturum

export async function createSession(userId: string, email: string): Promise<void> {
  const token = await new SignJWT({ sub: userId, email })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE}s`)
    .sign(secret());

  const store = await cookies();
  store.set(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: MAX_AGE,
  });
}

export async function destroySession(): Promise<void> {
  const store = await cookies();
  store.delete(COOKIE);
}

export type SessionUser = { id: string; email: string };

export async function getSession(): Promise<SessionUser | null> {
  const store = await cookies();
  const token = store.get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret());
    return { id: String(payload.sub), email: String(payload.email) };
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<SessionUser> {
  const s = await getSession();
  if (!s) throw new Error('UNAUTHORIZED');
  return s;
}

/** Middleware icinde kullanilir (Node API'siz dogrulama). */
export async function verifyToken(token: string): Promise<boolean> {
  try {
    await jwtVerify(token, secret());
    return true;
  } catch {
    return false;
  }
}

export const SESSION_COOKIE = COOKIE;

/** Gravatar benzeri avatar icin. */
export function emailHash(email: string): string {
  return createHash('sha256').update(email.trim().toLowerCase()).digest('hex');
}
