"use client";

import { Lock, Plus, Save, ShieldAlert, ShieldCheck, Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useMemo, useState, useTransition } from "react";
import { toast } from "sonner";

import {
  createAdminRoleAction,
  deleteAdminRoleAction,
  updateAdminRoleAction,
} from "@/app/pengaturan/hak-akses/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
import {
  ADMIN_PERMISSION_DEFINITIONS,
  adminHasPermission,
  canActorManagePermissions,
  type AdminPermission,
} from "@/lib/admin-permissions.mjs";
import type { AdminRoleItem } from "@/lib/admin-users-service";

const cardClass = "gap-0 rounded-[20px] p-5 ring-1 ring-border shadow-[0_8px_30px_rgba(29,58,46,0.035)]";

const PERMISSION_SECTIONS = Array.from(
  ADMIN_PERMISSION_DEFINITIONS.reduce((map, def) => {
    const list = map.get(def.section) ?? [];
    list.push(def);
    map.set(def.section, list);
    return map;
  }, new Map<string, (typeof ADMIN_PERMISSION_DEFINITIONS)[number][]>()),
);

function RoleEditorCard({
  currentAdmin,
  role,
  onDeleted,
}: {
  currentAdmin: AdminSessionUser;
  role: AdminRoleItem;
  onDeleted: () => void;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [roleName, setRoleName] = useState(role.name);
  const [roleDesc, setRoleDesc] = useState(role.description);
  const [selectedPerms, setSelectedPerms] = useState<Set<AdminPermission>>(
    () => new Set(role.permissions),
  );

  const actorCanEditSelectedRole = useMemo(() => {
    if (currentAdmin.isSuperuser) return true;
    if (currentAdmin.roleId === role.id) return false;
    return canActorManagePermissions(currentAdmin, role.permissions);
  }, [currentAdmin, role]);

  function togglePermission(key: AdminPermission) {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleSection(keys: AdminPermission[], enable: boolean) {
    setSelectedPerms((prev) => {
      const next = new Set(prev);
      for (const key of keys) {
        if (!currentAdmin.isSuperuser && !adminHasPermission(currentAdmin, key)) continue;
        if (enable) next.add(key);
        else next.delete(key);
      }
      return next;
    });
  }

  function handleSaveRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    startTransition(async () => {
      const res = await updateAdminRoleAction(role.id, {
        name: roleName,
        description: roleDesc,
        permissions: Array.from(selectedPerms),
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      router.refresh();
    });
  }

  function handleDeleteRole() {
    startTransition(async () => {
      const res = await deleteAdminRoleAction(role.id);
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      onDeleted();
      router.refresh();
    });
  }

  return (
    <Card className={cardClass}>
      <form onSubmit={handleSaveRole} className="space-y-6">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border pb-4">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-[18px] font-bold">{role.name}</h2>
              <Badge variant={role.isSystem ? "secondary" : "outline"} className="rounded-full text-[11px]">
                {role.isSystem ? "Peran Bawaan" : "Peran Kustom"}
              </Badge>
              <Badge variant="outline" className="rounded-full text-[11px]">
                Revisi #{role.revision}
              </Badge>
            </div>
            <p className="mt-1 text-[12px] text-muted-foreground">
              Dipakai oleh {role.userCount} akun pengguna
              {role.updatedByUsername ? ` · Terakhir disimpan oleh @${role.updatedByUsername}` : ""}.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {!role.isSystem && (
              <Button
                type="button"
                variant="outline"
                disabled={!actorCanEditSelectedRole || role.userCount > 0 || isPending}
                onClick={handleDeleteRole}
                className="h-9 rounded-xl text-destructive hover:text-destructive"
                title={
                  role.userCount > 0
                    ? "Pindahkan semua pengguna dari peran ini sebelum menghapus"
                    : undefined
                }
              >
                <Trash2 className="size-4" /> Hapus peran
              </Button>
            )}
            <Button
              type="submit"
              disabled={!actorCanEditSelectedRole || isPending}
              className="h-9 rounded-xl px-4 font-semibold"
            >
              {isPending ? <Spinner aria-hidden="true" /> : <Save className="size-4" />} Simpan hak akses
            </Button>
          </div>
        </div>

        {!actorCanEditSelectedRole && (
          <Alert variant="destructive" className="rounded-xl">
            <Lock className="size-4" />
            <AlertTitle className="font-semibold">Matriks hanya-baca</AlertTitle>
            <AlertDescription className="text-[12px]">
              Anda tidak dapat mengubah peran yang dipakai akun Anda sendiri atau peran yang memiliki hak akses melebihi kewenangan akun Anda.
            </AlertDescription>
          </Alert>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <label htmlFor="role-name" className="text-[12px] font-semibold">Nama peran</label>
            <Input
              id="role-name"
              required
              disabled={!actorCanEditSelectedRole}
              value={roleName}
              onChange={(e) => setRoleName(e.target.value)}
              maxLength={60}
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor="role-desc" className="text-[12px] font-semibold">Keterangan</label>
            <Input
              id="role-desc"
              disabled={!actorCanEditSelectedRole}
              value={roleDesc}
              onChange={(e) => setRoleDesc(e.target.value)}
              maxLength={200}
              placeholder="Ringkasan tugas peran ini"
            />
          </div>
        </div>

        <div className="space-y-5">
          {PERMISSION_SECTIONS.map(([section, items]) => {
            const sectionKeys = items.map((item) => item.key);
            const checkedCount = sectionKeys.filter((k) => selectedPerms.has(k)).length;
            return (
              <div key={section} className="rounded-2xl border border-border p-4">
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <h3 className="text-[13px] font-bold tracking-tight uppercase text-primary">{section}</h3>
                    <Badge variant="outline" className="rounded-full text-[11px]">
                      {checkedCount}/{items.length}
                    </Badge>
                  </div>
                  {actorCanEditSelectedRole && (
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleSection(sectionKeys, true)}
                        className="h-7 rounded-lg px-2 text-[11px]"
                      >
                        Pilih semua
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => toggleSection(sectionKeys, false)}
                        className="h-7 rounded-lg px-2 text-[11px] text-muted-foreground"
                      >
                        Kosongkan
                      </Button>
                    </div>
                  )}
                </div>

                <div className="grid gap-2.5 md:grid-cols-2">
                  {items.map((perm) => {
                    const checked = selectedPerms.has(perm.key);
                    const actorAllowed = currentAdmin.isSuperuser || adminHasPermission(currentAdmin, perm.key);
                    const disabled = !actorCanEditSelectedRole || !actorAllowed || isPending;
                    return (
                      <label
                        key={perm.key}
                        className={`flex items-start gap-3 rounded-xl border p-3 text-left transition-colors ${
                          checked ? "border-primary/45 bg-accent/50" : "border-border bg-card"
                        } ${disabled ? "cursor-not-allowed opacity-65" : "cursor-pointer hover:bg-accent/30"}`}
                      >
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={disabled}
                          onChange={() => togglePermission(perm.key)}
                          className="mt-0.5 size-4 shrink-0 accent-primary"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[13px] font-semibold text-foreground">{perm.label}</span>
                            {perm.sensitive && (
                              <Badge variant="outline" className="gap-1 rounded-md border-amber-500/40 bg-amber-500/10 px-1.5 py-0 text-[10px] text-amber-700 dark:text-amber-300">
                                <ShieldAlert className="size-2.5" /> Sensitif
                              </Badge>
                            )}
                          </span>
                          <span className="mt-0.5 block text-[11px] leading-relaxed text-muted-foreground">
                            {perm.description}
                          </span>
                        </span>
                      </label>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </form>
    </Card>
  );
}

export function RoleManager({
  currentAdmin,
  roles,
}: {
  currentAdmin: AdminSessionUser;
  roles: AdminRoleItem[];
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const [selectedRoleId, setSelectedRoleId] = useState<string>(roles[0]?.id ?? "");
  const selectedRole = useMemo(
    () => roles.find((r) => r.id === selectedRoleId) ?? roles[0] ?? null,
    [roles, selectedRoleId],
  );

  // Dialog tambah peran
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDesc, setNewDesc] = useState("");
  const [copyFromRoleId, setCopyFromRoleId] = useState("none");

  const manageableCreatePresets = useMemo(
    () => roles.filter((r) => canActorManagePermissions(currentAdmin, r.permissions)),
    [currentAdmin, roles],
  );

  function handleCreateRole(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const preset = copyFromRoleId !== "none" ? roles.find((r) => r.id === copyFromRoleId) : undefined;
    const initialPerms = preset ? preset.permissions : [];
    startTransition(async () => {
      const res = await createAdminRoleAction({
        name: newName,
        description: newDesc,
        permissions: initialPerms,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(res.message);
      setCreateOpen(false);
      setNewName("");
      setNewDesc("");
      setCopyFromRoleId("none");
      router.refresh();
    });
  }

  return (
    <div className="space-y-6">
      <Alert className="rounded-2xl border-border bg-accent/40">
        <ShieldCheck className="size-4 text-primary" />
        <AlertTitle className="font-semibold">Model hak akses peran</AlertTitle>
        <AlertDescription className="text-[12px]">
          Akun bertipe <strong>Superadmin</strong> selalu memiliki akses penuh ke seluruh fitur panel. Operator non-superadmin hanya dapat membuka halaman dan menjalankan tindakan yang dicentang pada perannya, dan perubahan berlaku seketika pada permintaan berikutnya.
        </AlertDescription>
      </Alert>

      <div className="grid items-start gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
        <Card className={cardClass}>
          <div className="flex items-center justify-between gap-2">
            <div>
              <h2 className="text-[15px] font-bold">Daftar Peran</h2>
              <p className="text-[12px] text-muted-foreground">{roles.length} peran terdaftar</p>
            </div>
            <Button
              type="button"
              size="sm"
              onClick={() => {
                setNewName("");
                setNewDesc("");
                setCopyFromRoleId("none");
                setCreateOpen(true);
              }}
              className="h-8 rounded-xl px-3 text-[12px] font-semibold"
            >
              <Plus className="size-3.5" /> Tambah
            </Button>
          </div>

          <div className="mt-4 space-y-2">
            {roles.map((role) => {
              const active = selectedRole?.id === role.id;
              return (
                <button
                  key={role.id}
                  type="button"
                  data-testid={`role-item-${role.slug}`}
                  onClick={() => setSelectedRoleId(role.id)}
                  className={`w-full rounded-2xl border p-3.5 text-left transition-colors ${
                    active
                      ? "border-primary bg-accent/70 shadow-xs"
                      : "border-border bg-card hover:bg-accent/35"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="font-semibold text-foreground">{role.name}</span>
                    <Badge variant={role.isSystem ? "secondary" : "outline"} className="shrink-0 rounded-md px-1.5 py-0.5 text-[10px]">
                      {role.isSystem ? "Bawaan" : "Kustom"}
                    </Badge>
                  </div>
                  <p className="mt-1 line-clamp-2 text-[11px] text-muted-foreground">
                    {role.description || "Tanpa keterangan."}
                  </p>
                  <div className="mt-2.5 flex items-center justify-between text-[11px] font-medium text-muted-foreground">
                    <span>{role.permissions.length} / {ADMIN_PERMISSION_DEFINITIONS.length} izin</span>
                    <span>{role.userCount} pengguna</span>
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {selectedRole ? (
          <RoleEditorCard
            key={`${selectedRole.id}:${selectedRole.revision}`}
            currentAdmin={currentAdmin}
            role={selectedRole}
            onDeleted={() => setSelectedRoleId("")}
          />
        ) : (
          <Card className={cardClass}>
            <p className="py-12 text-center text-[13px] text-muted-foreground">Belum ada peran yang terdaftar.</p>
          </Card>
        )}
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Buat Peran Baru</DialogTitle>
            <DialogDescription>
              Tambahkan peran kustom dan atur matriks hak aksesnya setelah peran dibuat.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateRole} className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="new-role-name" className="text-[12px] font-semibold">Nama peran</label>
              <Input
                id="new-role-name"
                required
                maxLength={60}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="mis. Wali Kelas"
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="new-role-desc" className="text-[12px] font-semibold">Keterangan</label>
              <Input
                id="new-role-desc"
                maxLength={200}
                value={newDesc}
                onChange={(e) => setNewDesc(e.target.value)}
                placeholder="mis. Mencetak kartu tanpa sandi dan memantau rekap nilai"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-[12px] font-semibold">Salin izin awal dari (opsional)</label>
              <Select value={copyFromRoleId} onValueChange={setCopyFromRoleId}>
                <SelectTrigger aria-label="Salin izin dari peran" className="w-full rounded-xl">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Mulai dari kosong (0 izin)</SelectItem>
                  {manageableCreatePresets.map((role) => (
                    <SelectItem key={role.id} value={role.id}>
                      {role.name} ({role.permissions.length} izin)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCreateOpen(false)}>Batal</Button>
              <Button type="submit" disabled={isPending}>{isPending && <Spinner aria-hidden="true" />}Buat peran</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
