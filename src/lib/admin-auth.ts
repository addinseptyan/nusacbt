import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { normalizeAdminUsername } from "@/lib/admin-username.mjs";
import { verifyPassword } from "@/lib/password.mjs";
import { getPostgresPool } from "@/lib/postgres";

const COOKIE_NAME = "nusacbt_admin_session";
const SESSION_SECONDS = 8 * 60 * 60;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
// Hash dummy publik hanya digunakan untuk menyamakan pekerjaan saat username tidak ditemukan.
const DUMMY_HASH = "scrypt$32768$8$3$bnVzYWNidC1kdW1teS12MQ$Raa-ekVKy8Za16jY9UvGVQe7QgcE8qumcVaR-QYwcSlPWOICqa72jz34cvRzGMbcqD08s2eMvJpOmu-lx5iNfA";

function digestToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

function secureCookie() {
  const setting = process.env.NUSACBT_COOKIE_SECURE;
  if (!setting) return process.env.NODE_ENV === "production";
  if (setting === "true") return true;
  if (setting === "false") return false;
  throw new Error("NUSACBT_COOKIE_SECURE harus true atau false.");
}

type LoginRow = {
  id: string;
  password_hash: string;
  failed_attempts: number;
  is_locked: boolean;
  lock_expired: boolean;
};

export async function authenticateAdmin(rawUsername: unknown, password: unknown): Promise<string | null> {
  const username = normalizeAdminUsername(rawUsername);
  if (!username || typeof password !== "string" || !password || Buffer.byteLength(password, "utf8") > 512) return null;

  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<LoginRow>(
      `SELECT id, password_hash, failed_attempts,
        COALESCE(locked_until > now(), false) AS is_locked,
        COALESCE(locked_until <= now(), false) AS lock_expired
       FROM admin_users WHERE username = $1 FOR UPDATE`,
      [username],
    );
    const admin = result.rows[0];
    const passwordMatches = await verifyPassword(password, admin?.password_hash ?? DUMMY_HASH);

    if (!admin || admin.is_locked) {
      await client.query("COMMIT");
      return null;
    }
    if (!passwordMatches) {
      const failures = admin.lock_expired ? 1 : admin.failed_attempts + 1;
      await client.query(
        `UPDATE admin_users SET failed_attempts = $2,
          locked_until = CASE WHEN $2 >= 5 THEN now() + interval '15 minutes' ELSE NULL END
         WHERE id = $1`,
        [admin.id, failures],
      );
      await client.query("COMMIT");
      return null;
    }

    const token = randomBytes(32).toString("base64url");
    await client.query("UPDATE admin_users SET failed_attempts = 0, locked_until = NULL WHERE id = $1", [admin.id]);
    await client.query("DELETE FROM admin_sessions WHERE expires_at <= now()");
    await client.query(
      "INSERT INTO admin_sessions (token_hash, admin_id, expires_at) VALUES ($1, $2, now() + interval '8 hours')",
      [digestToken(token), admin.id],
    );
    await client.query("COMMIT");
    return token;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function setAdminSessionCookie(token: string) {
  const store = await cookies();
  store.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: secureCookie(),
    sameSite: "strict",
    path: "/",
    maxAge: SESSION_SECONDS,
  });
}

export async function getAdminSession() {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token || !TOKEN_FORMAT.test(token)) return null;
  const result = await getPostgresPool().query<{ id: string; username: string }>(
    `SELECT a.id, a.username FROM admin_sessions s
     JOIN admin_users a ON a.id = s.admin_id
     WHERE s.token_hash = $1 AND s.expires_at > now()`,
    [digestToken(token)],
  );
  return result.rows[0] ?? null;
}

export async function requireAdmin() {
  let admin;
  try {
    admin = await getAdminSession();
  } catch {
    redirect("/login?error=database");
  }
  if (!admin) redirect("/login");
  return admin;
}

export async function endAdminSession() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token && TOKEN_FORMAT.test(token)) {
    await getPostgresPool().query("DELETE FROM admin_sessions WHERE token_hash = $1", [digestToken(token)]);
  }
  store.delete(COOKIE_NAME);
}
