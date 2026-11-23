import "server-only";
import type { PoolClient } from "pg";

import {
  lockActiveAdminSession,
  PERMISSION_DENIED_MESSAGE,
  type AdminSessionUser,
} from "@/lib/admin-auth";
import {
  adminHasPermission,
  canActorManagePermissions,
  makeRoleSlug,
  normalizePermissionList,
  validateAdminPasswordReset,
  validateAdminRoleInput,
  validateAdminUserCreate,
  validateAdminUserUpdate,
  type AdminPermission,
} from "@/lib/admin-permissions.mjs";
import { hashPassword } from "@/lib/password.mjs";
import { getPostgresPool } from "@/lib/postgres";

const POSITIVE_BIGINT_ID = /^[1-9]\d{0,18}$/;

export type AdminRoleItem = {
  id: string;
  slug: string;
  name: string;
  description: string;
  isSystem: boolean;
  revision: number;
  userCount: number;
  permissions: AdminPermission[];
  updatedByUsername: string | null;
  updatedAt: string;
};

export type AdminUserItem = {
  id: string;
  username: string;
  fullName: string;
  isSuperuser: boolean;
  isActive: boolean;
  isLocked: boolean;
  lockedUntil: string | null;
  failedAttempts: number;
  roleId: string | null;
  roleSlug: string | null;
  roleName: string | null;
  lastLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type AdminUserAuditEvent =
  | "create"
  | "update"
  | "reset_password"
  | "activate"
  | "deactivate"
  | "unlock";

export type AdminUserAuditItem = {
  id: string;
  targetUserId: string | null;
  targetUsername: string;
  actorUsername: string;
  event: AdminUserAuditEvent;
  detail: string;
  occurredAt: string;
};

export type AdminActionResult = { ok: true; message: string } | { ok: false; error: string };

function isPgErrorCode(error: unknown, ...codes: string[]) {
  return Boolean(error && typeof error === "object" && "code" in error && typeof (error as { code?: string }).code === "string" && codes.includes((error as { code: string }).code));
}

async function listRolesWithClient(client: PoolClient): Promise<AdminRoleItem[]> {
  const result = await client.query<{
    id: string;
    slug: string;
    name: string;
    description: string;
    isSystem: boolean;
    revision: number;
    userCount: number;
    permissions: string[] | null;
    updatedByUsername: string | null;
    updatedAt: string;
  }>(
    `SELECT r.id::text AS id,
       r.slug,
       r.name,
       r.description,
       r.is_system AS "isSystem",
       r.revision::int AS revision,
       COUNT(u.id)::int AS "userCount",
       COALESCE(
         ARRAY(
           SELECT rp.permission_key
           FROM admin_role_permissions rp
           WHERE rp.role_id = r.id
           ORDER BY rp.permission_key
         ),
         '{}'::text[]
       ) AS permissions,
       ub.username AS "updatedByUsername",
       r.updated_at::text AS "updatedAt"
     FROM admin_roles r
     LEFT JOIN admin_users u ON u.role_id = r.id
     LEFT JOIN admin_users ub ON ub.id = r.updated_by
     GROUP BY r.id, ub.username
     ORDER BY r.is_system DESC, r.name ASC, r.id ASC`,
  );
  return result.rows.map((row) => ({
    ...row,
    permissions: normalizePermissionList(row.permissions ?? []),
  }));
}

async function listUsersWithClient(client: PoolClient): Promise<AdminUserItem[]> {
  const result = await client.query<AdminUserItem>(
    `SELECT u.id::text AS id,
       u.username,
       u.full_name AS "fullName",
       u.is_superuser AS "isSuperuser",
       u.is_active AS "isActive",
       COALESCE(u.locked_until > clock_timestamp(), false) AS "isLocked",
       u.locked_until::text AS "lockedUntil",
       u.failed_attempts AS "failedAttempts",
       u.role_id::text AS "roleId",
       r.slug AS "roleSlug",
       r.name AS "roleName",
       u.last_login_at::text AS "lastLoginAt",
       u.created_at::text AS "createdAt",
       u.updated_at::text AS "updatedAt"
     FROM admin_users u
     LEFT JOIN admin_roles r ON r.id = u.role_id
     ORDER BY u.is_superuser DESC, u.is_active DESC, u.username ASC`,
  );
  return result.rows;
}

async function listAuditWithClient(client: PoolClient, limit = 40): Promise<AdminUserAuditItem[]> {
  const result = await client.query<AdminUserAuditItem>(
    `SELECT id::text AS id,
       target_user_id::text AS "targetUserId",
       target_username_snapshot AS "targetUsername",
       actor_username_snapshot AS "actorUsername",
       event,
       detail,
       occurred_at::text AS "occurredAt"
     FROM admin_user_audit
     ORDER BY id DESC
     LIMIT $1`,
    [limit],
  );
  return result.rows;
}

export async function loadAdminUsersPageData(): Promise<{
  users: AdminUserItem[];
  roles: AdminRoleItem[];
  auditLogs: AdminUserAuditItem[];
}> {
  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN READ ONLY ISOLATION LEVEL REPEATABLE READ");
    const users = await listUsersWithClient(client);
    const roles = await listRolesWithClient(client);
    const auditLogs = await listAuditWithClient(client);
    await client.query("COMMIT");
    return { users, roles, auditLogs };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function loadAdminRolesPageData(): Promise<{
  roles: AdminRoleItem[];
}> {
  const client = await getPostgresPool().connect();
  try {
    const roles = await listRolesWithClient(client);
    return { roles };
  } finally {
    client.release();
  }
}

async function readRoleForAssignment(
  client: PoolClient,
  roleId: string,
): Promise<{ id: string; name: string; permissions: AdminPermission[] } | null> {
  const roleRes = await client.query<{ id: string; name: string }>(
    `SELECT id::text AS id, name FROM admin_roles WHERE id = $1::bigint FOR SHARE`,
    [roleId],
  );
  const role = roleRes.rows[0];
  if (!role) return null;
  const permRes = await client.query<{ permissionKey: string }>(
    `SELECT permission_key AS "permissionKey" FROM admin_role_permissions WHERE role_id = $1::bigint ORDER BY permission_key`,
    [roleId],
  );
  return {
    id: role.id,
    name: role.name,
    permissions: normalizePermissionList(permRes.rows.map((p) => p.permissionKey)),
  };
}

async function countOtherActiveSuperusers(client: PoolClient, excludedUserId: string): Promise<number> {
  // Kunci semua baris superadmin agar dua permintaan bersamaan tidak bisa menonaktifkan dua superadmin terakhir.
  const res = await client.query<{ id: string; isActive: boolean }>(
    `SELECT id::text AS id, is_active AS "isActive" FROM admin_users WHERE is_superuser = true FOR UPDATE`,
  );
  return res.rows.filter((row) => row.isActive && row.id !== excludedUserId).length;
}

async function insertAuditLog(
  client: PoolClient,
  actor: AdminSessionUser,
  targetUserId: string,
  targetUsername: string,
  event: AdminUserAuditEvent,
  detail: string,
) {
  await client.query(
    `INSERT INTO admin_user_audit (
       target_user_id, target_username_snapshot, actor_id, actor_username_snapshot, event, detail
     ) VALUES ($1::bigint, $2, $3::bigint, $4, $5, $6)`,
    [targetUserId, targetUsername, actor.id, actor.username, event, detail],
  );
}

export async function createAdminUser(input: unknown): Promise<AdminActionResult> {
  const validated = validateAdminUserCreate(input);
  if (!validated.ok) return validated;
  const data = validated.value;

  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const actor = await lockActiveAdminSession(client);
    if (!actor) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Sesi admin tidak valid." };
    }
    if (!adminHasPermission(actor, "users.manage")) {
      await client.query("ROLLBACK");
      return { ok: false, error: PERMISSION_DENIED_MESSAGE };
    }

    if (data.isSuperuser && !actor.isSuperuser) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Hanya Superadmin yang dapat membuat akun Superadmin." };
    }

    let roleSummary = "Superadmin";
    if (!data.isSuperuser) {
      const role = data.roleId ? await readRoleForAssignment(client, data.roleId) : null;
      if (!role) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Peran hak akses yang dipilih tidak ditemukan." };
      }
      if (!canActorManagePermissions(actor, role.permissions)) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Anda tidak dapat menetapkan peran yang memiliki izin melebihi akun Anda." };
      }
      roleSummary = role.name;
    }

    const passwordHash = await hashPassword(data.password);
    const inserted = await client.query<{ id: string; username: string }>(
      `INSERT INTO admin_users (
         username, full_name, password_hash, is_superuser, is_active, role_id
       ) VALUES ($1, $2, $3, $4, $5, $6::bigint)
       RETURNING id::text AS id, username`,
      [data.username, data.fullName, passwordHash, data.isSuperuser, data.isActive, data.roleId],
    );
    const created = inserted.rows[0];
    await insertAuditLog(
      client,
      actor,
      created.id,
      created.username,
      "create",
      `Menambahkan akun ${data.fullName} (${roleSummary}, ${data.isActive ? "aktif" : "nonaktif"}).`,
    );
    await client.query("COMMIT");
    return { ok: true, message: `Pengguna ${created.username} berhasil ditambahkan.` };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (isPgErrorCode(error, "23505")) {
      return { ok: false, error: "Username sudah dipakai pengguna lain." };
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function updateAdminUser(userId: string, input: unknown): Promise<AdminActionResult> {
  if (!POSITIVE_BIGINT_ID.test(userId)) {
    return { ok: false, error: "ID pengguna tidak valid." };
  }
  const validated = validateAdminUserUpdate(input);
  if (!validated.ok) return validated;
  const data = validated.value;

  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const actor = await lockActiveAdminSession(client);
    if (!actor) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Sesi admin tidak valid." };
    }
    if (!adminHasPermission(actor, "users.manage")) {
      await client.query("ROLLBACK");
      return { ok: false, error: PERMISSION_DENIED_MESSAGE };
    }
    await client.query("SELECT pg_advisory_xact_lock($1)", [2026111726]);

    const targetRes = await client.query<{
      id: string;
      username: string;
      fullName: string;
      isSuperuser: boolean;
      isActive: boolean;
      roleId: string | null;
    }>(
      `SELECT id::text AS id, username, full_name AS "fullName",
         is_superuser AS "isSuperuser", is_active AS "isActive", role_id::text AS "roleId"
       FROM admin_users WHERE id = $1::bigint FOR UPDATE`,
      [userId],
    );
    const target = targetRes.rows[0];
    if (!target) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Pengguna tidak ditemukan." };
    }

    if ((target.isSuperuser || data.isSuperuser) && !actor.isSuperuser) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Hanya Superadmin yang dapat mengubah akun atau status Superadmin." };
    }
    if (target.id === actor.id && !data.isActive) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Akun Anda sendiri tidak dapat dinonaktifkan." };
    }
    if (target.id === actor.id && target.isSuperuser && !data.isSuperuser) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Status Superadmin akun Anda sendiri tidak dapat dicabut." };
    }
    if (!actor.isSuperuser && target.id === actor.id && data.roleId !== target.roleId) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Anda tidak dapat mengubah peran akun Anda sendiri." };
    }

    if (target.isSuperuser && target.isActive && (!data.isSuperuser || !data.isActive)) {
      const others = await countOtherActiveSuperusers(client, target.id);
      if (others < 1) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Sistem harus tetap memiliki minimal satu Superadmin aktif." };
      }
    }

    // Pastikan operator non-superadmin tidak dapat mengambil alih atau mengubah target dengan izin di atas dirinya.
    if (!actor.isSuperuser && target.roleId) {
      const existingRole = await readRoleForAssignment(client, target.roleId);
      if (existingRole && !canActorManagePermissions(actor, existingRole.permissions)) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Anda tidak dapat mengubah akun yang memiliki izin di atas akun Anda." };
      }
    }

    let roleSummary = "Superadmin";
    if (!data.isSuperuser) {
      const role = data.roleId ? await readRoleForAssignment(client, data.roleId) : null;
      if (!role) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Peran hak akses yang dipilih tidak ditemukan." };
      }
      if (!canActorManagePermissions(actor, role.permissions)) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Anda tidak dapat menetapkan peran yang memiliki izin melebihi akun Anda." };
      }
      roleSummary = role.name;
    }

    await client.query(
      `UPDATE admin_users
       SET full_name = $2,
           is_superuser = $3,
           is_active = $4,
           role_id = $5::bigint,
           updated_at = now()
       WHERE id = $1::bigint`,
      [target.id, data.fullName, data.isSuperuser, data.isActive, data.roleId],
    );

    if (!data.isActive) {
      await client.query(`DELETE FROM admin_sessions WHERE admin_id = $1::bigint`, [target.id]);
    }

    await insertAuditLog(
      client,
      actor,
      target.id,
      target.username,
      "update",
      `Memperbarui profil ${data.fullName} (${roleSummary}, ${data.isActive ? "aktif" : "nonaktif"}).`,
    );
    await client.query("COMMIT");
    return { ok: true, message: `Data pengguna ${target.username} berhasil diperbarui.` };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function resetAdminUserPassword(userId: string, input: unknown): Promise<AdminActionResult> {
  if (!POSITIVE_BIGINT_ID.test(userId)) {
    return { ok: false, error: "ID pengguna tidak valid." };
  }
  const validated = validateAdminPasswordReset(input);
  if (!validated.ok) return validated;

  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const actor = await lockActiveAdminSession(client);
    if (!actor) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Sesi admin tidak valid." };
    }
    if (!adminHasPermission(actor, "users.manage")) {
      await client.query("ROLLBACK");
      return { ok: false, error: PERMISSION_DENIED_MESSAGE };
    }

    const targetRes = await client.query<{
      id: string;
      username: string;
      isSuperuser: boolean;
      roleId: string | null;
    }>(
      `SELECT id::text AS id, username, is_superuser AS "isSuperuser", role_id::text AS "roleId"
       FROM admin_users WHERE id = $1::bigint FOR UPDATE`,
      [userId],
    );
    const target = targetRes.rows[0];
    if (!target) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Pengguna tidak ditemukan." };
    }

    if (target.isSuperuser && !actor.isSuperuser) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Hanya Superadmin yang dapat mengatur ulang sandi Superadmin." };
    }
    if (!actor.isSuperuser && target.roleId) {
      const role = await readRoleForAssignment(client, target.roleId);
      if (role && !canActorManagePermissions(actor, role.permissions)) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Anda tidak dapat mengatur ulang sandi pengguna di atas kewenangan Anda." };
      }
    }

    const passwordHash = await hashPassword(validated.value);
    await client.query(
      `UPDATE admin_users
       SET password_hash = $2,
           failed_attempts = 0,
           locked_until = NULL,
           updated_at = now()
       WHERE id = $1::bigint`,
      [target.id, passwordHash],
    );
    const deletedSessions = await client.query(
      `DELETE FROM admin_sessions WHERE admin_id = $1::bigint`,
      [target.id],
    );

    await insertAuditLog(
      client,
      actor,
      target.id,
      target.username,
      "reset_password",
      `Mengatur ulang kata sandi dan mencabut ${deletedSessions.rowCount ?? 0} sesi aktif.`,
    );
    await client.query("COMMIT");
    return { ok: true, message: `Kata sandi ${target.username} telah diatur ulang dan semua sesi aktif dicabut.` };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function toggleAdminUserActive(userId: string, active: boolean): Promise<AdminActionResult> {
  if (!POSITIVE_BIGINT_ID.test(userId)) {
    return { ok: false, error: "ID pengguna tidak valid." };
  }

  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const actor = await lockActiveAdminSession(client);
    if (!actor) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Sesi admin tidak valid." };
    }
    if (!adminHasPermission(actor, "users.manage")) {
      await client.query("ROLLBACK");
      return { ok: false, error: PERMISSION_DENIED_MESSAGE };
    }
    await client.query("SELECT pg_advisory_xact_lock($1)", [2026111726]);

    const targetRes = await client.query<{
      id: string;
      username: string;
      isSuperuser: boolean;
      isActive: boolean;
      roleId: string | null;
    }>(
      `SELECT id::text AS id, username, is_superuser AS "isSuperuser",
         is_active AS "isActive", role_id::text AS "roleId"
       FROM admin_users WHERE id = $1::bigint FOR UPDATE`,
      [userId],
    );
    const target = targetRes.rows[0];
    if (!target) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Pengguna tidak ditemukan." };
    }

    if (target.isSuperuser && !actor.isSuperuser) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Hanya Superadmin yang dapat mengubah status akun Superadmin." };
    }
    if (!actor.isSuperuser && target.roleId) {
      const role = await readRoleForAssignment(client, target.roleId);
      if (role && !canActorManagePermissions(actor, role.permissions)) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Anda tidak dapat mengubah status pengguna di atas kewenangan Anda." };
      }
    }
    if (target.id === actor.id && !active) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Akun Anda sendiri tidak dapat dinonaktifkan." };
    }
    if (!active && target.isSuperuser && target.isActive) {
      const others = await countOtherActiveSuperusers(client, target.id);
      if (others < 1) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Sistem harus tetap memiliki minimal satu Superadmin aktif." };
      }
    }

    await client.query(
      `UPDATE admin_users SET is_active = $2, updated_at = now() WHERE id = $1::bigint`,
      [target.id, active],
    );
    if (!active) {
      await client.query(`DELETE FROM admin_sessions WHERE admin_id = $1::bigint`, [target.id]);
    }

    await insertAuditLog(
      client,
      actor,
      target.id,
      target.username,
      active ? "activate" : "deactivate",
      active ? "Mengaktifkan kembali akun pengguna." : "Menonaktifkan akun dan mencabut sesi aktif.",
    );
    await client.query("COMMIT");
    return {
      ok: true,
      message: active
        ? `Akun ${target.username} telah diaktifkan kembali.`
        : `Akun ${target.username} telah dinonaktifkan dan sesinya dicabut.`,
    };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function unlockAdminUser(userId: string): Promise<AdminActionResult> {
  if (!POSITIVE_BIGINT_ID.test(userId)) {
    return { ok: false, error: "ID pengguna tidak valid." };
  }

  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const actor = await lockActiveAdminSession(client);
    if (!actor) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Sesi admin tidak valid." };
    }
    if (!adminHasPermission(actor, "users.manage")) {
      await client.query("ROLLBACK");
      return { ok: false, error: PERMISSION_DENIED_MESSAGE };
    }

    const targetRes = await client.query<{
      id: string;
      username: string;
      isSuperuser: boolean;
      roleId: string | null;
    }>(
      `SELECT id::text AS id, username, is_superuser AS "isSuperuser", role_id::text AS "roleId"
       FROM admin_users WHERE id = $1::bigint FOR UPDATE`,
      [userId],
    );
    const target = targetRes.rows[0];
    if (!target) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Pengguna tidak ditemukan." };
    }

    if (target.isSuperuser && !actor.isSuperuser) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Hanya Superadmin yang dapat membuka kunci akun Superadmin." };
    }
    if (!actor.isSuperuser && target.roleId) {
      const role = await readRoleForAssignment(client, target.roleId);
      if (role && !canActorManagePermissions(actor, role.permissions)) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Anda tidak dapat membuka kunci akun di atas kewenangan Anda." };
      }
    }

    await client.query(
      `UPDATE admin_users
       SET failed_attempts = 0, locked_until = NULL, updated_at = now()
       WHERE id = $1::bigint`,
      [target.id],
    );
    await insertAuditLog(
      client,
      actor,
      target.id,
      target.username,
      "unlock",
      "Membuka penguncian login akibat percobaan sandi gagal.",
    );
    await client.query("COMMIT");
    return { ok: true, message: `Penguncian login akun ${target.username} berhasil dibuka.` };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function allocateUniqueRoleSlug(client: PoolClient, name: string): Promise<string> {
  const base = makeRoleSlug(name);
  const existing = await client.query<{ slug: string }>(
    `SELECT slug FROM admin_roles WHERE slug = $1 OR slug LIKE $2`,
    [base, `${base}_%`],
  );
  const used = new Set(existing.rows.map((r) => r.slug));
  if (!used.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const candidate = makeRoleSlug(name, String(i));
    if (!used.has(candidate)) return candidate;
  }
  return makeRoleSlug(name, String(Date.now()).slice(-6));
}

export async function createAdminRole(input: unknown): Promise<AdminActionResult> {
  const validated = validateAdminRoleInput(input);
  if (!validated.ok) return validated;
  const data = validated.value;

  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const actor = await lockActiveAdminSession(client);
    if (!actor) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Sesi admin tidak valid." };
    }
    if (!adminHasPermission(actor, "roles.manage")) {
      await client.query("ROLLBACK");
      return { ok: false, error: PERMISSION_DENIED_MESSAGE };
    }
    if (!canActorManagePermissions(actor, data.permissions)) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Anda hanya dapat memberikan hak akses yang juga dimiliki akun Anda." };
    }

    const slug = await allocateUniqueRoleSlug(client, data.name);
    const inserted = await client.query<{ id: string }>(
      `INSERT INTO admin_roles (slug, name, description, is_system, updated_by)
       VALUES ($1, $2, $3, false, $4::bigint)
       RETURNING id::text AS id`,
      [slug, data.name, data.description, actor.id],
    );
    const roleId = inserted.rows[0].id;
    if (data.permissions.length > 0) {
      await client.query(
        `INSERT INTO admin_role_permissions (role_id, permission_key)
         SELECT $1::bigint, UNNEST($2::varchar[])`,
        [roleId, data.permissions],
      );
    }

    await client.query("COMMIT");
    return { ok: true, message: `Peran "${data.name}" berhasil dibuat.` };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (isPgErrorCode(error, "23505")) {
      return { ok: false, error: "Nama peran sudah digunakan." };
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function updateAdminRole(roleId: string, input: unknown): Promise<AdminActionResult> {
  if (!POSITIVE_BIGINT_ID.test(roleId)) {
    return { ok: false, error: "ID peran tidak valid." };
  }
  const validated = validateAdminRoleInput(input);
  if (!validated.ok) return validated;
  const data = validated.value;

  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const actor = await lockActiveAdminSession(client);
    if (!actor) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Sesi admin tidak valid." };
    }
    if (!adminHasPermission(actor, "roles.manage")) {
      await client.query("ROLLBACK");
      return { ok: false, error: PERMISSION_DENIED_MESSAGE };
    }
    if (!canActorManagePermissions(actor, data.permissions)) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Anda hanya dapat memberikan hak akses yang juga dimiliki akun Anda." };
    }

    const roleRes = await client.query<{ id: string; name: string }>(
      `SELECT id::text AS id, name FROM admin_roles WHERE id = $1::bigint FOR UPDATE`,
      [roleId],
    );
    const role = roleRes.rows[0];
    if (!role) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Peran hak akses tidak ditemukan." };
    }

    const existingPermRes = await client.query<{ permissionKey: string }>(
      `SELECT permission_key AS "permissionKey" FROM admin_role_permissions WHERE role_id = $1::bigint`,
      [role.id],
    );
    const existingPerms = normalizePermissionList(existingPermRes.rows.map((p) => p.permissionKey));
    if (!actor.isSuperuser) {
      if (actor.roleId === role.id) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Anda tidak dapat mengubah peran yang sedang dipakai akun Anda sendiri." };
      }
      if (!canActorManagePermissions(actor, existingPerms)) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Anda tidak dapat mengubah peran yang memiliki izin di atas akun Anda." };
      }
    }

    await client.query(
      `UPDATE admin_roles
       SET name = $2,
           description = $3,
           revision = revision + 1,
           updated_by = $4::bigint,
           updated_at = now()
       WHERE id = $1::bigint`,
      [role.id, data.name, data.description, actor.id],
    );
    await client.query(`DELETE FROM admin_role_permissions WHERE role_id = $1::bigint`, [role.id]);
    if (data.permissions.length > 0) {
      await client.query(
        `INSERT INTO admin_role_permissions (role_id, permission_key)
         SELECT $1::bigint, UNNEST($2::varchar[])`,
        [role.id, data.permissions],
      );
    }

    await client.query("COMMIT");
    return { ok: true, message: `Hak akses peran "${data.name}" berhasil disimpan.` };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (isPgErrorCode(error, "23505")) {
      return { ok: false, error: "Nama peran sudah digunakan." };
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function deleteAdminRole(roleId: string): Promise<AdminActionResult> {
  if (!POSITIVE_BIGINT_ID.test(roleId)) {
    return { ok: false, error: "ID peran tidak valid." };
  }

  const client = await getPostgresPool().connect();
  try {
    await client.query("BEGIN");
    const actor = await lockActiveAdminSession(client);
    if (!actor) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Sesi admin tidak valid." };
    }
    if (!adminHasPermission(actor, "roles.manage")) {
      await client.query("ROLLBACK");
      return { ok: false, error: PERMISSION_DENIED_MESSAGE };
    }

    const roleRes = await client.query<{ id: string; name: string; isSystem: boolean }>(
      `SELECT id::text AS id, name, is_system AS "isSystem" FROM admin_roles WHERE id = $1::bigint FOR UPDATE`,
      [roleId],
    );
    const role = roleRes.rows[0];
    if (!role) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Peran hak akses tidak ditemukan." };
    }
    if (role.isSystem) {
      await client.query("ROLLBACK");
      return { ok: false, error: "Peran bawaan sistem tidak dapat dihapus." };
    }

    if (!actor.isSuperuser) {
      if (actor.roleId === role.id) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Anda tidak dapat menghapus peran yang sedang dipakai akun Anda." };
      }
      const existingPermRes = await client.query<{ permissionKey: string }>(
        `SELECT permission_key AS "permissionKey" FROM admin_role_permissions WHERE role_id = $1::bigint`,
        [role.id],
      );
      const existingPerms = normalizePermissionList(existingPermRes.rows.map((p) => p.permissionKey));
      if (!canActorManagePermissions(actor, existingPerms)) {
        await client.query("ROLLBACK");
        return { ok: false, error: "Anda tidak dapat menghapus peran yang memiliki izin di atas akun Anda." };
      }
    }

    const assignedRes = await client.query<{ count: number }>(
      `SELECT COUNT(*)::int AS count FROM admin_users WHERE role_id = $1::bigint`,
      [role.id],
    );
    const assignedCount = assignedRes.rows[0]?.count ?? 0;
    if (assignedCount > 0) {
      await client.query("ROLLBACK");
      return { ok: false, error: `Peran "${role.name}" masih dipakai oleh ${assignedCount} pengguna.` };
    }

    await client.query(`DELETE FROM admin_roles WHERE id = $1::bigint`, [role.id]);
    await client.query("COMMIT");
    return { ok: true, message: `Peran "${role.name}" berhasil dihapus.` };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => {});
    if (isPgErrorCode(error, "23503", "23001")) {
      return { ok: false, error: "Peran masih dipakai oleh pengguna lain." };
    }
    throw error;
  } finally {
    client.release();
  }
}
