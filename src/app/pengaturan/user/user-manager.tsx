"use client";

import {
  History,
  KeyRound,
  Lock,
  LockOpen,
  Pencil,
  Plus,
  Search,
  ShieldCheck,
  UserCheck,
  UserX,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createAdminUserAction,
  resetAdminUserPasswordAction,
  toggleAdminUserActiveAction,
  unlockAdminUserAction,
  updateAdminUserAction,
} from "@/app/pengaturan/user/actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";
import type { AdminSessionUser } from "@/lib/admin-auth";
import { canActorManagePermissions } from "@/lib/admin-permissions.mjs";
import type {
  AdminRoleItem,
  AdminUserAuditEvent,
  AdminUserAuditItem,
  AdminUserItem,
} from "@/lib/admin-users-service";

const cardClass = "gap-0 rounded-[20px] p-5 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]";

const AUDIT_LABELS: Record<AdminUserAuditEvent, string> = {
  create: "Akun dibuat",
  update: "Profil diperbarui",
  reset_password: "Reset sandi",
  activate: "Diaktifkan",
  deactivate: "Dinonaktifkan",
  unlock: "Buka kunci",
};

function formatDateTime(value: string | null) {
  if (!value) return "Belum pernah masuk";
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat("id-ID", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Jakarta",
  }).format(parsed);
}

export function UserManager({
  currentAdmin,
  users,
  roles,
  auditLogs,
}: {
  currentAdmin: AdminSessionUser;
  users: AdminUserItem[];
  roles: AdminRoleItem[];
  auditLogs: AdminUserAuditItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "inactive" | "locked">("all");

  // Dialog tambah pengguna
  const [createOpen, setCreateOpen] = useState(false);
  const [createUsername, setCreateUsername] = useState("");
  const [createFullName, setCreateFullName] = useState("");
  const [createPassword, setCreatePassword] = useState("");
  const [createPasswordConfirmation, setCreatePasswordConfirmation] = useState("");
  const [createIsSuperuser, setCreateIsSuperuser] = useState(false);
  const [createRoleId, setCreateRoleId] = useState("");
  const [createIsActive, setCreateIsActive] = useState(true);

  // Dialog edit pengguna
  const [editUser, setEditUser] = useState<AdminUserItem | null>(null);
  const [editFullName, setEditFullName] = useState("");
  const [editIsSuperuser, setEditIsSuperuser] = useState(false);
  const [editRoleId, setEditRoleId] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

  // Dialog reset sandi
  const [resetUser, setResetUser] = useState<AdminUserItem | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [resetPasswordConfirmation, setResetPasswordConfirmation] = useState("");

  const roleById = useMemo(() => new Map(roles.map((role) => [role.id, role])), [roles]);

  const manageableRoles = useMemo(
    () => roles.filter((role) => canActorManagePermissions(currentAdmin, role.permissions)),
    [currentAdmin, roles],
  );

  function canManageTarget(target: AdminUserItem) {
    if (target.isSuperuser) return currentAdmin.isSuperuser;
    if (!target.roleId) return true;
    const role = roleById.get(target.roleId);
    return role ? canActorManagePermissions(currentAdmin, role.permissions) : currentAdmin.isSuperuser;
  }

  const activeSuperuserCount = useMemo(
    () => users.filter((u) => u.isSuperuser && u.isActive).length,
    [users],
  );

  const filteredUsers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return users.filter((u) => {
      if (statusFilter === "active" && !u.isActive) return false;
      if (statusFilter === "inactive" && u.isActive) return false;
      if (statusFilter === "locked" && !u.isLocked) return false;
      if (!q) return true;
      return (
        u.username.toLowerCase().includes(q) ||
        u.fullName.toLowerCase().includes(q) ||
        (u.roleName ?? "").toLowerCase().includes(q)
      );
    });
  }, [users, search, statusFilter]);

  const counts = useMemo(
    () => ({
      total: users.length,
      active: users.filter((u) => u.isActive).length,
      superusers: users.filter((u) => u.isSuperuser).length,
      locked: users.filter((u) => u.isLocked).length,
    }),
    [users],
  );

  function openCreateDialog() {
    setCreateUsername("");
    setCreateFullName("");
    setCreatePassword("");
    setCreatePasswordConfirmation("");
    setCreateIsSuperuser(false);
    setCreateRoleId(manageableRoles[0]?.id ?? "");
    setCreateIsActive(true);
    setCreateOpen(true);
  }

  function openEditDialog(user: AdminUserItem) {
    setEditUser(user);
    setEditFullName(user.fullName);
    setEditIsSuperuser(user.isSuperuser);
    setEditRoleId(user.roleId ?? manageableRoles[0]?.id ?? "");
    setEditIsActive(user.isActive);
  }

  function openResetDialog(user: AdminUserItem) {
    setResetUser(user);
    setResetPassword("");
    setResetPasswordConfirmation("");
  }

  function handleCreateSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const res = await createAdminUserAction({
        username: createUsername,
        fullName: createFullName,
        password: createPassword,
        passwordConfirmation: createPasswordConfirmation,
        isSuperuser: createIsSuperuser,
        isActive: createIsActive,
        roleId: createIsSuperuser ? null : createRoleId || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setCreateOpen(false);
      router.refresh();
    });
  }

  function handleEditSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editUser) return;
    startTransition(async () => {
      const res = await updateAdminUserAction(editUser.id, {
        fullName: editFullName,
        isSuperuser: editIsSuperuser,
        isActive: editIsActive,
        roleId: editIsSuperuser ? null : editRoleId || null,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setEditUser(null);
      router.refresh();
    });
  }

  function handleResetSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!resetUser) return;
    startTransition(async () => {
      const res = await resetAdminUserPasswordAction(resetUser.id, {
        password: resetPassword,
        passwordConfirmation: resetPasswordConfirmation,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setResetUser(null);
      router.refresh();
    });
  }

  function handleToggleActive(user: AdminUserItem) {
    startTransition(async () => {
      const res = await toggleAdminUserActiveAction(user.id, !user.isActive);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  }

  function handleUnlock(user: AdminUserItem) {
    startTransition(async () => {
      const res = await unlockAdminUserAction(user.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-4">
        <Card className={cardClass}>
          <p className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">Total akun</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight">{counts.total}</p>
        </Card>
        <Card className={cardClass}>
          <p className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">Akun aktif</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight text-primary">{counts.active}</p>
        </Card>
        <Card className={cardClass}>
          <p className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">Superadmin</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight">{counts.superusers}</p>
        </Card>
        <Card className={cardClass}>
          <p className="text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">Terkunci login</p>
          <p className="mt-2 text-2xl font-extrabold tracking-tight text-destructive">{counts.locked}</p>
        </Card>
      </div>

      <Card className={cardClass}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-1 flex-wrap items-center gap-2.5">
            <div className="relative min-w-56 flex-1 sm:max-w-xs">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Cari nama, username, atau peran..."
                aria-label="Cari pengguna"
                className="h-9 rounded-xl pl-9"
              />
            </div>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as typeof statusFilter)}>
              <SelectTrigger aria-label="Filter status pengguna" className="h-9 w-44 rounded-xl">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Semua status</SelectItem>
                <SelectItem value="active">Aktif</SelectItem>
                <SelectItem value="inactive">Nonaktif</SelectItem>
                <SelectItem value="locked">Terkunci login</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button type="button" onClick={openCreateDialog} className="h-9 rounded-xl px-4 font-semibold">
            <Plus className="size-4" /> Tambah pengguna
          </Button>
        </div>

        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[760px] border-collapse text-left text-[13px]">
            <thead>
              <tr className="border-b border-border text-[11px] font-bold tracking-[0.08em] text-muted-foreground uppercase">
                <th className="py-3 pr-4">Pengguna</th>
                <th className="py-3 pr-4">Peran</th>
                <th className="py-3 pr-4">Status</th>
                <th className="py-3 pr-4">Login terakhir</th>
                <th className="py-3 text-right">Tindakan</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/70">
              {filteredUsers.map((user) => {
                const isSelf = user.id === currentAdmin.id;
                const canManage = canManageTarget(user);
                const isLastActiveSuper = user.isSuperuser && user.isActive && activeSuperuserCount <= 1;

                return (
                  <tr key={user.id} data-testid={`user-row-${user.username}`} className="align-middle">
                    <td className="py-3.5 pr-4">
                      <div className="flex items-center gap-2.5">
                        <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-accent text-xs font-bold text-accent-foreground">
                          {(user.fullName || user.username).slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-semibold text-foreground">{user.fullName || user.username}</span>
                            {isSelf && <Badge variant="secondary" className="h-5 rounded-md px-1.5 text-[10px]">Akun Anda</Badge>}
                          </div>
                          <p className="text-[12px] text-muted-foreground">@{user.username}</p>
                        </div>
                      </div>
                    </td>
                    <td className="py-3.5 pr-4">
                      {user.isSuperuser ? (
                        <Badge className="gap-1 rounded-full bg-primary/12 text-primary hover:bg-primary/15">
                          <ShieldCheck className="size-3.5" /> Superadmin
                        </Badge>
                      ) : user.roleName ? (
                        <Badge variant="outline" className="rounded-full font-medium">
                          {user.roleName}
                        </Badge>
                      ) : (
                        <Badge variant="destructive" className="rounded-full">Tanpa peran (0 izin)</Badge>
                      )}
                    </td>
                    <td className="py-3.5 pr-4">
                      <div className="flex flex-wrap items-center gap-1.5">
                        {user.isActive ? (
                          <Badge variant="secondary" className="rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
                            Aktif
                          </Badge>
                        ) : (
                          <Badge variant="outline" className="rounded-full text-muted-foreground">
                            Nonaktif
                          </Badge>
                        )}
                        {user.isLocked && (
                          <Badge variant="destructive" className="gap-1 rounded-full">
                            <Lock className="size-3" /> Terkunci
                          </Badge>
                        )}
                      </div>
                    </td>
                    <td className="py-3.5 pr-4 text-[12px] text-muted-foreground">
                      {formatDateTime(user.lastLoginAt)}
                    </td>
                    <td className="py-3.5 text-right">
                      <div className="inline-flex flex-wrap justify-end gap-1.5">
                        {user.isLocked && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={!canManage || isPending}
                            onClick={() => handleUnlock(user)}
                            className="h-8 rounded-lg px-2.5 text-[12px]"
                          >
                            <LockOpen className="size-3.5" /> Buka kunci
                          </Button>
                        )}
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!canManage || isPending}
                          onClick={() => openEditDialog(user)}
                          className="h-8 rounded-lg px-2.5 text-[12px]"
                        >
                          <Pencil className="size-3.5" /> Edit
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={!canManage || isPending}
                          onClick={() => openResetDialog(user)}
                          className="h-8 rounded-lg px-2.5 text-[12px]"
                        >
                          <KeyRound className="size-3.5" /> Reset sandi
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant={user.isActive ? "ghost" : "outline"}
                          disabled={!canManage || isSelf || isLastActiveSuper || isPending}
                          onClick={() => handleToggleActive(user)}
                          className="h-8 rounded-lg px-2.5 text-[12px]"
                          title={
                            isSelf
                              ? "Akun Anda sendiri tidak dapat dinonaktifkan"
                              : isLastActiveSuper
                                ? "Minimal satu Superadmin harus tetap aktif"
                                : undefined
                          }
                        >
                          {user.isActive ? (
                            <>
                              <UserX className="size-3.5" /> Nonaktifkan
                            </>
                          ) : (
                            <>
                              <UserCheck className="size-3.5" /> Aktifkan
                            </>
                          )}
                        </Button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {filteredUsers.length === 0 && (
                <tr>
                  <td colSpan={5} className="py-10 text-center text-[13px] text-muted-foreground">
                    Tidak ada pengguna yang cocok dengan pencarian/filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className={cardClass}>
        <div className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <History className="size-4" />
          </span>
          <div>
            <h2 className="text-[15px] font-bold">Riwayat Perubahan Akun</h2>
            <p className="text-[12px] text-muted-foreground">Catatan pembuatan akun, pembaruan peran, reset sandi, dan aktivasi.</p>
          </div>
        </div>
        <div className="mt-4 divide-y divide-border/70">
          {auditLogs.map((log) => (
            <div key={log.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5 text-[12px]">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <Badge variant="outline" className="rounded-md px-2 py-0.5 text-[11px]">
                  {AUDIT_LABELS[log.event]}
                </Badge>
                <span className="font-semibold text-foreground">@{log.targetUsername}</span>
                <span className="text-muted-foreground">{log.detail}</span>
              </div>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                oleh @{log.actorUsername} · {formatDateTime(log.occurredAt)}
              </span>
            </div>
          ))}
          {auditLogs.length === 0 && (
            <p className="py-6 text-center text-[12px] text-muted-foreground">Belum ada catatan perubahan akun.</p>
          )}
        </div>
      </Card>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Tambah Pengguna Panel</DialogTitle>
            <DialogDescription>
              Buat akun baru untuk operator ujian, pembuat soal, pengawas, atau superadmin.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="create-username" className="text-[12px] font-semibold">Username</label>
              <Input
                id="create-username"
                name="username"
                required
                value={createUsername}
                onChange={(e) => setCreateUsername(e.target.value)}
                placeholder="mis. op_ujian"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="create-fullname" className="text-[12px] font-semibold">Nama lengkap</label>
              <Input
                id="create-fullname"
                name="fullName"
                required
                value={createFullName}
                onChange={(e) => setCreateFullName(e.target.value)}
                placeholder="mis. Budi Santoso"
              />
            </div>
            {currentAdmin.isSuperuser && (
              <label className="flex items-center gap-2.5 rounded-xl border border-border p-3 text-[13px]">
                <input
                  type="checkbox"
                  checked={createIsSuperuser}
                  onChange={(e) => setCreateIsSuperuser(e.target.checked)}
                  className="size-4 accent-primary"
                />
                <span>
                  <span className="font-semibold">Jadikan Superadmin</span>
                  <span className="block text-[11px] text-muted-foreground">Memiliki akses penuh ke seluruh fitur panel.</span>
                </span>
              </label>
            )}
            {!createIsSuperuser && (
              <div className="space-y-1.5">
                <label className="text-[12px] font-semibold">Peran hak akses</label>
                <Select value={createRoleId} onValueChange={setCreateRoleId}>
                  <SelectTrigger aria-label="Pilih peran pengguna baru" className="w-full rounded-xl">
                    <SelectValue placeholder="Pilih peran..." />
                  </SelectTrigger>
                  <SelectContent>
                    {manageableRoles.map((role) => (
                      <SelectItem key={role.id} value={role.id}>
                        {role.name} ({role.permissions.length} izin)
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <label htmlFor="create-password" className="text-[12px] font-semibold">Kata sandi awal</label>
                <Input
                  id="create-password"
                  type="password"
                  required
                  minLength={12}
                  value={createPassword}
                  onChange={(e) => setCreatePassword(e.target.value)}
                  placeholder="Min. 12 karakter"
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="create-password-confirm" className="text-[12px] font-semibold">Konfirmasi sandi</label>
                <Input
                  id="create-password-confirm"
                  type="password"
                  required
                  minLength={12}
                  value={createPasswordConfirmation}
                  onChange={(e) => setCreatePasswordConfirmation(e.target.value)}
                  placeholder="Ulangi sandi"
                  autoComplete="new-password"
                />
              </div>
            </div>
            <label className="flex items-center gap-2 text-[13px]">
              <input
                type="checkbox"
                checked={createIsActive}
                onChange={(e) => setCreateIsActive(e.target.checked)}
                className="size-4 accent-primary"
              />
              <span>Aktifkan akun segera setelah dibuat</span>
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Batal</Button>
              <Button type="submit" disabled={isPending}>{isPending && <Spinner aria-hidden="true" />}Simpan pengguna</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(editUser)} onOpenChange={(open) => !open && setEditUser(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Pengguna @{editUser?.username}</DialogTitle>
            <DialogDescription>
              Perbarui nama tampilan, peran hak akses, dan status keaktifan akun.
            </DialogDescription>
          </DialogHeader>
          {editUser && (
            <form onSubmit={handleEditSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="edit-fullname" className="text-[12px] font-semibold">Nama lengkap</label>
                <Input
                  id="edit-fullname"
                  required
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                />
              </div>
              {currentAdmin.isSuperuser && (
                <label className="flex items-center gap-2.5 rounded-xl border border-border p-3 text-[13px]">
                  <input
                    type="checkbox"
                    checked={editIsSuperuser}
                    disabled={editUser.id === currentAdmin.id && editUser.isSuperuser}
                    onChange={(e) => setEditIsSuperuser(e.target.checked)}
                    className="size-4 accent-primary"
                  />
                  <span>
                    <span className="font-semibold">Status Superadmin</span>
                    <span className="block text-[11px] text-muted-foreground">Akses penuh ke semua modul tanpa batasan peran.</span>
                  </span>
                </label>
              )}
              {!editIsSuperuser && (
                <div className="space-y-1.5">
                  <label className="text-[12px] font-semibold">Peran hak akses</label>
                  <Select
                    value={editRoleId}
                    onValueChange={setEditRoleId}
                    disabled={!currentAdmin.isSuperuser && editUser.id === currentAdmin.id}
                  >
                    <SelectTrigger aria-label="Pilih peran pengguna" className="w-full rounded-xl">
                      <SelectValue placeholder="Pilih peran..." />
                    </SelectTrigger>
                    <SelectContent>
                      {manageableRoles.map((role) => (
                        <SelectItem key={role.id} value={role.id}>
                          {role.name} ({role.permissions.length} izin)
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}
              <label className="flex items-center gap-2 text-[13px]">
                <input
                  type="checkbox"
                  checked={editIsActive}
                  disabled={editUser.id === currentAdmin.id}
                  onChange={(e) => setEditIsActive(e.target.checked)}
                  className="size-4 accent-primary"
                />
                <span>Akun aktif (dapat masuk ke panel)</span>
              </label>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditUser(null)}>Batal</Button>
                <Button type="submit" disabled={isPending}>{isPending && <Spinner aria-hidden="true" />}Simpan perubahan</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(resetUser)} onOpenChange={(open) => !open && setResetUser(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Reset Kata Sandi @{resetUser?.username}</DialogTitle>
            <DialogDescription>
              Mengatur ulang sandi akan segera mencabut seluruh sesi login aktif milik pengguna ini.
            </DialogDescription>
          </DialogHeader>
          {resetUser && (
            <form onSubmit={handleResetSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="reset-password" className="text-[12px] font-semibold">Kata sandi baru</label>
                <Input
                  id="reset-password"
                  type="password"
                  required
                  minLength={12}
                  value={resetPassword}
                  onChange={(e) => setResetPassword(e.target.value)}
                  placeholder="Min. 12 karakter"
                  autoComplete="new-password"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="reset-password-confirm" className="text-[12px] font-semibold">Konfirmasi sandi baru</label>
                <Input
                  id="reset-password-confirm"
                  type="password"
                  required
                  minLength={12}
                  value={resetPasswordConfirmation}
                  onChange={(e) => setResetPasswordConfirmation(e.target.value)}
                  placeholder="Ulangi sandi baru"
                  autoComplete="new-password"
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setResetUser(null)}>Batal</Button>
                <Button type="submit" disabled={isPending}>{isPending && <Spinner aria-hidden="true" />}Simpan sandi baru</Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
