import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import {
  ADMIN_PERMISSION_DEFINITIONS,
  ADMIN_PERMISSION_KEYS,
  ADMIN_PERMISSION_KEY_SET,
  adminHasAnyPermission,
  adminHasPermission,
  canActorManagePermissions,
  isValidAdminPermission,
  makeRoleSlug,
  normalizePermissionList,
  validateAdminFullName,
  validateAdminPasswordReset,
  validateAdminRoleInput,
  validateAdminUserCreate,
  validateAdminUserUpdate,
} from "../../src/lib/admin-permissions.mjs";

const root = fileURLToPath(new URL("../..", import.meta.url));

test("katalog hak akses memuat 21 izin unik dan sinkron dengan migrasi 026 serta navigation.ts", () => {
  assert.equal(ADMIN_PERMISSION_DEFINITIONS.length, 21);
  assert.equal(ADMIN_PERMISSION_KEY_SET.size, 21);

  const sensitiveKeys = ADMIN_PERMISSION_DEFINITIONS.filter((d) => d.sensitive).map((d) => d.key);
  assert.deepEqual(sensitiveKeys, [
    "participant_passwords.manage",
    "grading_overrides.manage",
    "tools.manage",
    "app_settings.manage",
    "users.manage",
    "roles.manage",
  ]);

  const migrationSql = readFileSync(join(root, "migrations", "026_admin_users_rbac.sql"), "utf8");
  for (const key of ADMIN_PERMISSION_KEYS) {
    assert.ok(migrationSql.includes(`'${key}'`), `Migrasi 026 harus mencantumkan izin ${key}`);
  }

  const navSource = readFileSync(join(root, "src", "lib", "navigation.ts"), "utf8");
  const matches = navSource.matchAll(/permissions:\s*\[([^\]]+)\]/g);
  for (const match of matches) {
    for (const token of match[1].matchAll(/"([^"]+)"/g)) {
      assert.ok(isValidAdminPermission(token[1]), `navigation.ts memakai izin tidak dikenal: ${token[1]}`);
    }
  }
});

test("pengecekan izin menangani superuser, operator, null, dan eskalasi kewenangan", () => {
  const superuser = { isSuperuser: true, permissions: [] };
  const operator = { isSuperuser: false, permissions: ["monitoring.view", "tokens.manage"] };

  assert.equal(adminHasPermission(null, "users.manage"), false);
  assert.equal(adminHasPermission(superuser, "users.manage"), true);
  assert.equal(adminHasPermission(operator, "monitoring.view"), true);
  assert.equal(adminHasPermission(operator, "grading_overrides.manage"), false);

  assert.equal(adminHasAnyPermission(operator, []), true);
  assert.equal(adminHasAnyPermission(operator, ["reports.view", "tokens.manage"]), true);
  assert.equal(adminHasAnyPermission(operator, ["users.manage", "roles.manage"]), false);

  assert.equal(canActorManagePermissions(superuser, ADMIN_PERMISSION_KEYS), true);
  assert.equal(canActorManagePermissions(operator, ["monitoring.view"]), true);
  assert.equal(canActorManagePermissions(operator, ["monitoring.view", "users.manage"]), false);
  assert.deepEqual(
    normalizePermissionList(["tokens.manage", "unknown.key", "topics.manage", "tokens.manage"]),
    ["topics.manage", "tokens.manage"],
  );
});

test("validator nama lengkap, peran, slug, pembuatan akun, pembaruan akun, dan reset sandi bekerja akurat", () => {
  assert.deepEqual(validateAdminFullName("  Budi   Santoso  "), { ok: true, value: "Budi Santoso" });
  assert.equal(validateAdminFullName("   ").ok, false);
  assert.equal(validateAdminFullName("Budi\u0007").ok, false);
  assert.equal(validateAdminFullName("a".repeat(101)).ok, false);

  const roleOk = validateAdminRoleInput({
    name: "  Wali   Kelas ",
    description: " Memantau  nilai ",
    permissions: ["reports.view", "topics.manage", "reports.view"],
  });
  assert.deepEqual(roleOk, {
    ok: true,
    value: {
      name: "Wali Kelas",
      description: "Memantau nilai",
      permissions: ["topics.manage", "reports.view"],
    },
  });
  assert.equal(validateAdminRoleInput({ name: "Test", description: "", permissions: ["bad.perm"] }).ok, false);
  assert.equal(validateAdminRoleInput({ name: "", description: "", permissions: [] }).ok, false);

  assert.equal(makeRoleSlug("Pengawas / Proktor"), "pengawas_proktor");
  assert.equal(makeRoleSlug("123 Tes"), "role_123_tes");
  assert.equal(makeRoleSlug("Wali Kelas", "2"), "wali_kelas_2");

  const userOk = validateAdminUserCreate({
    username: "  Operator.Satu  ",
    fullName: "Operator Satu",
    password: "Sandi-Panjang-Aman-2026!",
    passwordConfirmation: "Sandi-Panjang-Aman-2026!",
    isSuperuser: false,
    isActive: true,
    roleId: "2",
  });
  assert.equal(userOk.ok, true);
  if (userOk.ok) {
    assert.equal(userOk.value.username, "operator.satu");
    assert.equal(userOk.value.roleId, "2");
  }

  assert.equal(
    validateAdminUserCreate({
      username: "operator_dua",
      fullName: "Operator Dua",
      password: "Sandi-Panjang-Aman-2026!",
      passwordConfirmation: "Beda-2026!",
      isSuperuser: false,
      roleId: "2",
    }).ok,
    false,
  );
  assert.equal(
    validateAdminUserCreate({
      username: "operator_dua",
      fullName: "Operator Dua",
      password: "Sandi-Panjang-Aman-2026!",
      passwordConfirmation: "Sandi-Panjang-Aman-2026!",
      isSuperuser: false,
      roleId: "",
    }).ok,
    false,
  );

  const superCreate = validateAdminUserCreate({
    username: "super_baru",
    fullName: "Super Baru",
    password: "Sandi-Panjang-Aman-2026!",
    passwordConfirmation: "Sandi-Panjang-Aman-2026!",
    isSuperuser: true,
    roleId: "2",
  });
  assert.equal(superCreate.ok, true);
  if (superCreate.ok) assert.equal(superCreate.value.roleId, null);

  assert.equal(
    validateAdminUserUpdate({ fullName: "Nama Baru", isSuperuser: false, isActive: true, roleId: null }).ok,
    false,
  );
  assert.deepEqual(
    validateAdminUserUpdate({ fullName: "Nama Baru", isSuperuser: true, isActive: false, roleId: "3" }),
    { ok: true, value: { fullName: "Nama Baru", isSuperuser: true, isActive: false, roleId: null } },
  );

  assert.equal(
    validateAdminPasswordReset({ password: "Pendek", passwordConfirmation: "Pendek" }).ok,
    false,
  );
  assert.deepEqual(
    validateAdminPasswordReset({
      password: "Sandi-Baru-Super-Aman-2026",
      passwordConfirmation: "Sandi-Baru-Super-Aman-2026",
    }),
    { ok: true, value: "Sandi-Baru-Super-Aman-2026" },
  );
});
