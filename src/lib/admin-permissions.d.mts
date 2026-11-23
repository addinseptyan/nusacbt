export type AdminPermission =
  | "topics.manage"
  | "questions.manage"
  | "questions.import"
  | "questions.export"
  | "academic_years.manage"
  | "periods.manage"
  | "classes.manage"
  | "students.manage"
  | "participant_accounts.manage"
  | "participant_passwords.manage"
  | "participant_cards.print"
  | "exams.manage"
  | "exam_controls.manage"
  | "monitoring.view"
  | "grading_overrides.manage"
  | "tokens.manage"
  | "reports.view"
  | "tools.manage"
  | "app_settings.manage"
  | "users.manage"
  | "roles.manage";

export type AdminPermissionDefinition = {
  key: AdminPermission;
  section: string;
  label: string;
  description: string;
  sensitive: boolean;
};

export type AdminAuthLike = {
  isSuperuser: boolean;
  permissions: readonly AdminPermission[];
} | null | undefined;

export const ADMIN_PERMISSION_DEFINITIONS: readonly AdminPermissionDefinition[];
export const ADMIN_PERMISSION_KEYS: readonly AdminPermission[];
export const ADMIN_PERMISSION_KEY_SET: ReadonlySet<AdminPermission>;

export function isValidAdminPermission(key: unknown): key is AdminPermission;
export function normalizePermissionList(keys: unknown): AdminPermission[];
export function adminHasPermission(user: AdminAuthLike, permission: AdminPermission): boolean;
export function adminHasAnyPermission(user: AdminAuthLike, required: readonly AdminPermission[]): boolean;
export function canActorManagePermissions(actor: AdminAuthLike, permissions: readonly AdminPermission[]): boolean;

export function validateAdminFullName(raw: unknown): { ok: true; value: string } | { ok: false; error: string };
export function validateAdminRoleInput(input: unknown):
  | { ok: true; value: { name: string; description: string; permissions: AdminPermission[] } }
  | { ok: false; error: string };
export function makeRoleSlug(name: string, suffix?: string): string;
export function validateAdminUserCreate(input: unknown):
  | {
      ok: true;
      value: {
        username: string;
        fullName: string;
        password: string;
        isSuperuser: boolean;
        isActive: boolean;
        roleId: string | null;
      };
    }
  | { ok: false; error: string };
export function validateAdminUserUpdate(input: unknown):
  | {
      ok: true;
      value: {
        fullName: string;
        isSuperuser: boolean;
        isActive: boolean;
        roleId: string | null;
      };
    }
  | { ok: false; error: string };
export function validateAdminPasswordReset(input: unknown): { ok: true; value: string } | { ok: false; error: string };
