import { createHash, randomBytes, randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { getDb, schema } from "@/lib/db";

export const SESSION_COOKIE = "safenav_session";
const SESSION_DAYS = 30;

export type User = typeof schema.users.$inferSelect;
export type PublicUser = Pick<User, "id" | "name" | "email" | "phone" | "autoSos" | "shareLive">;

export function sha256(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

export function newId() {
  return randomUUID();
}

/** 128-bit URL-safe random token. */
export function newToken() {
  return randomBytes(16).toString("base64url");
}

export function hashPassword(password: string) {
  return bcrypt.hash(password, 12);
}

export function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

export function toPublicUser(u: User): PublicUser {
  return { id: u.id, name: u.name, email: u.email, phone: u.phone, autoSos: u.autoSos, shareLive: u.shareLive };
}

export async function createSession(userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86_400_000);
  const db = await getDb();
  await db.insert(schema.sessions).values({ tokenHash: sha256(token), userId, expiresAt });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
}

export async function destroySession() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) {
    const db = await getDb();
    await db.delete(schema.sessions).where(eq(schema.sessions.tokenHash, sha256(token)));
  }
  jar.delete(SESSION_COOKIE);
}

export async function currentUser(): Promise<User | null> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const db = await getDb();
  const [row] = await db
    .select({ user: schema.users, expiresAt: schema.sessions.expiresAt })
    .from(schema.sessions)
    .innerJoin(schema.users, eq(schema.users.id, schema.sessions.userId))
    .where(eq(schema.sessions.tokenHash, sha256(token)))
    .limit(1);
  if (!row || row.expiresAt.getTime() < Date.now()) return null;
  return row.user;
}
