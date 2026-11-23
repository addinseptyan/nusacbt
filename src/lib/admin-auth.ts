import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { PoolClient } from "pg";

import {
  adminHasAnyPermission,
  normalizePermissionList,
  type AdminPermission,
} from "@/lib/admin-permissions.mjs";
import { normalizeAdminUsername } from "@/lib/admin-username.mjs";
import { verifyPassword } from "@/lib/password.mjs";
import { getPostgresPool } from "@/lib/postgres";

const COOKIE_NAME = "nusacbt_admin_session";
const SESSION_SECONDS = 8 * 60 * 60;
const TOKEN_FORMAT = /^[A-Za-z0-9_-]{43}$/;
// Hash dummy publik hanya digunakan untuk menyamakan pekerjaan saat username tidak ditemukan.
const DUMMY_HASH = "scrypt$32768$8$3$bnVzYWNidC1kdW1teS12MQ$Raa-ekVKy8Za16jY9UvGVQe7QgcE8qumcVaR-QYwcSlPWOICqa72jz34cvRzGMbcqD08s2eMvJpOmu-lx5iNfA";

export const PERMISSION_DENIED_MESSAGE = "Anda tidak memiliki hak akses untuk tindakan ini.";

export type AdminSessionUser = {
  id: string;
  username: string;
  fullName: string;
  isSuperuser: boolean;
  roleId: string | null;
  roleName: string | null;
  permissions: AdminPermission[];
};

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
  is_active: boolean;
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
      `SELECT id, password_hash, failed_attempts, is_active,
        COALESCE(locked_until > now(), false) AS is_locked,
        COALESCE(locked_until <= now(), false) AS lock_expired
       FROM admin_users WHERE username = $1 FOR UPDATE`,
      [username],
    );
    const admin = result.rows[0];
    const passwordMatches = await verifyPassword(password, admin?.password_hash ?? DUMMY_HASH);

    if (!admin || !admin.is_active || admin.is_locked) {
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
    await client.query(
      "UPDATE admin_users SET failed_attempts = 0, locked_until = NULL, last_login_at = now() WHERE id = $1",
      [admin.id],
    );
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

type SessionQueryRow = {
  id: string;
  username: string;
  fullName: string;
  isSuperuser: boolean;
  roleId: string | null;
  roleName: string | null;
  permissions: string[] | null;
};

function mapSessionUser(row: SessionQueryRow): AdminSessionUser {
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName || row.username,
    isSuperuser: Boolean(row.isSuperuser),
    roleId: row.roleId,
    roleName: row.isSuperuser ? "Superadmin" : row.roleName,
    permissions: row.isSuperuser ? [] : normalizePermissionList(row.permissions ?? []),
  };
}

export const getAdminSession = cache(async (): Promise<AdminSessionUser | null> => {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token || !TOKEN_FORMAT.test(token)) return null;
  const result = await getPostgresPool().query<SessionQueryRow>(
    `SELECT a.id::text AS id,
       a.username,
       a.full_name AS "fullName",
       a.is_superuser AS "isSuperuser",
       a.role_id::text AS "roleId",
       r.name AS "roleName",
       CASE WHEN a.is_superuser OR a.role_id IS NULL THEN '{}'::text[]
         ELSE ARRAY(SELECT rp.permission_key FROM admin_role_permissions rp WHERE rp.role_id = a.role_id ORDER BY rp.permission_key)
       END AS permissions
     FROM admin_sessions s
     JOIN admin_users a ON a.id = s.admin_id
     LEFT JOIN admin_roles r ON r.id = a.role_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND a.is_active = true`,
    [digestToken(token)],
  );
  const row = result.rows[0];
  return row ? mapSessionUser(row) : null;
});

export async function getAdminSessionSafe(): Promise<AdminSessionUser | null> {
  try {
    return await getAdminSession();
  } catch {
    return null;
  }
}

// Untuk tindakan sensitif: periksa sesi dan status aktif/izin di dalam transaksi
// sambil menahan penghapusan/mutasi sesi, user, dan peran hingga commit.
export async function lockActiveAdminSession(client: PoolClient): Promise<AdminSessionUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token || !TOKEN_FORMAT.test(token)) return null;
  const result = await client.query<{
    id: string;
    username: string;
    fullName: string;
    isSuperuser: boolean;
    roleId: string | null;
  }>(
    `SELECT a.id::text AS id,
       a.username,
       a.full_name AS "fullName",
       a.is_superuser AS "isSuperuser",
       a.role_id::text AS "roleId"
     FROM admin_sessions s
     JOIN admin_users a ON a.id = s.admin_id
     WHERE s.token_hash = $1 AND s.expires_at > clock_timestamp() AND a.is_active = true
     FOR SHARE OF s, a`,
    [digestToken(token)],
  );
  const row = result.rows[0];
  if (!row) return null;

  let roleName: string | null = null;
  let permissions: string[] = [];
  if (!row.isSuperuser && row.roleId) {
    const roleResult = await client.query<{ name: string }>(
      "SELECT name FROM admin_roles WHERE id = $1::bigint FOR SHARE",
      [row.roleId],
    );
    roleName = roleResult.rows[0]?.name ?? null;
    if (roleName !== null) {
      const permResult = await client.query<{ permissionKey: string }>(
        `SELECT permission_key AS "permissionKey" FROM admin_role_permissions WHERE role_id = $1::bigint`,
        [row.roleId],
      );
      permissions = permResult.rows.map((p) => p.permissionKey);
    }
  }

  return mapSessionUser({
    ...row,
    roleName,
    permissions,
  });
}

export async function requireAdmin(): Promise<AdminSessionUser> {
  let admin: AdminSessionUser | null;
  try {
    admin = await getAdminSession();
  } catch {
    redirect("/login?error=database");
  }
  if (!admin) redirect("/login");
  return admin;
}

export async function requireAdminAccess(...required: AdminPermission[]): Promise<{ admin: AdminSessionUser; allowed: boolean }> {
  const admin = await requireAdmin();
  return {
    admin,
    allowed: required.length === 0 || adminHasAnyPermission(admin, required),
  };
}

export async function endAdminSession() {
  const store = await cookies();
  const token = store.get(COOKIE_NAME)?.value;
  if (token && TOKEN_FORMAT.test(token)) {
    await getPostgresPool().query("DELETE FROM admin_sessions WHERE token_hash = $1", [digestToken(token)]);
  }
  store.delete(COOKIE_NAME);
}
