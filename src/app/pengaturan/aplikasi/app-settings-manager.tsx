"use client";

import {
  AlertTriangle,
  Check,
  CheckCircle2,
  CircleAlert,
  Clock,
  Download,
  ExternalLink,
  Image as ImageIcon,
  Info,
  Lock,
  Palette,
  RefreshCw,
  RotateCcw,
  Save,
  School,
  Tag,
  Trash2,
  Upload,
  Wrench,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { checkAppUpdateAction, resetDevDatabaseAction, saveAppSettingsAction } from "@/app/pengaturan/aplikasi/actions";
import { useCurrentAdminUser } from "@/components/admin-user-context";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Spinner } from "@/components/ui/spinner";
import type { AdminAppSettings } from "@/lib/app-settings-types";
import { getAppVersionInfo, type CheckUpdateResult } from "@/lib/app-version.mjs";
import {
  APP_COLOR_PALETTES,
  APP_TIME_ZONES,
  type AppModeId,
  type AppTimeZone,
  type ColorPaletteId,
} from "@/lib/app-settings-validation.mjs";

const inputClass =
  "h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";
const textareaClass =
  "min-h-28 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

export function AppSettingsManager({ initialSettings }: { initialSettings: AdminAppSettings }) {
  const router = useRouter();
  const currentUser = useCurrentAdminUser();
  const isSuperuser = Boolean(currentUser?.isSuperuser);
  const [settings, setSettings] = useState(initialSettings);
  const [appName, setAppName] = useState(initialSettings.appName);
  const [appDescription, setAppDescription] = useState(initialSettings.appDescription);
  const [schoolName, setSchoolName] = useState(initialSettings.schoolName);
  const [participantInfo, setParticipantInfo] = useState(initialSettings.participantInfo);
  const [colorPalette, setColorPalette] = useState<ColorPaletteId>(initialSettings.colorPalette);
  const [defaultTimeZone, setDefaultTimeZone] = useState<AppTimeZone>(initialSettings.defaultTimeZone);
  const [appMode, setAppMode] = useState<AppModeId>(initialSettings.appMode);
  const [devConfirmOpen, setDevConfirmOpen] = useState(false);
  const [resetOpen, setResetOpen] = useState(false);
  const [resetAck, setResetAck] = useState(false);
  const [resetPhrase, setResetPhrase] = useState("");
  const [resetPending, setResetPending] = useState(false);
  const [resetError, setResetError] = useState("");
  const [removeLogo, setRemoveLogo] = useState(false);
  const [logoFileName, setLogoFileName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [updatePending, setUpdatePending] = useState(false);
  const [updateResult, setUpdateResult] = useState<CheckUpdateResult | null>(null);
  const versionInfo = getAppVersionInfo();

  const logoInputRef = useRef<HTMLInputElement>(null);

  async function handleCheckUpdate() {
    if (updatePending) return;
    setUpdatePending(true);
    try {
      const result = await checkAppUpdateAction();
      if (!result.ok && result.sessionExpired) {
        router.push("/login");
        router.refresh();
        return;
      }
      setUpdateResult(result);
    } catch {
      setUpdateResult({
        ok: false,
        currentVersion: versionInfo.version,
        currentTag: versionInfo.tag,
        offline: true,
        error: "Pemeriksaan pembaruan gagal diselesaikan. Periksa koneksi jaringan server.",
      });
    } finally {
      setUpdatePending(false);
    }
  }

  async function submitSave() {
    if (pending || resetPending) return;
    setPending(true);
    setError("");

    const formData = new FormData();
    formData.set("appName", appName);
    formData.set("appDescription", appDescription);
    formData.set("schoolName", schoolName);
    formData.set("participantInfo", participantInfo);
    formData.set("colorPalette", colorPalette);
    formData.set("defaultTimeZone", defaultTimeZone);
    if (isSuperuser) formData.set("appMode", appMode);
    formData.set("revision", settings.revision);
    if (removeLogo) formData.set("removeLogo", "1");

    const logoFile = logoInputRef.current?.files?.[0];
    if (logoFile && logoFile.size > 0) formData.set("logoFile", logoFile);

    try {
      const result = await saveAppSettingsAction(formData);
      if (!result.ok) {
        if (result.sessionExpired) {
          router.push("/login");
          router.refresh();
          return;
        }
        setError(result.error);
        return;
      }
      setSettings(result.settings);
      setAppName(result.settings.appName);
      setAppDescription(result.settings.appDescription);
      setSchoolName(result.settings.schoolName);
      setParticipantInfo(result.settings.participantInfo);
      setColorPalette(result.settings.colorPalette);
      setDefaultTimeZone(result.settings.defaultTimeZone);
      setAppMode(result.settings.appMode);
      setDevConfirmOpen(false);
      setRemoveLogo(false);
      setLogoFileName("");
      if (logoInputRef.current) logoInputRef.current.value = "";
      document.documentElement.setAttribute("data-palette", result.settings.colorPalette);
      toast.success(result.message);
      router.refresh();
    } catch {
      setError("Pengaturan gagal disimpan. Periksa koneksi server dan coba lagi.");
    } finally {
      setPending(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || resetPending) return;
    if (isSuperuser && appMode === "dev" && settings.appMode !== "dev") {
      setDevConfirmOpen(true);
      return;
    }
    await submitSave();
  }

  async function handleResetDatabase() {
    if (resetPending || pending) return;
    setResetPending(true);
    setResetError("");
    try {
      const result = await resetDevDatabaseAction({
        acknowledged: resetAck,
        confirmPhrase: resetPhrase,
      });
      if (!result.ok) {
        if (result.sessionExpired) {
          router.push("/login");
          router.refresh();
          return;
        }
        setResetError(result.error);
        return;
      }
      setResetOpen(false);
      setResetAck(false);
      setResetPhrase("");
      setRemoveLogo(false);
      setLogoFileName("");
      if (logoInputRef.current) logoInputRef.current.value = "";
      document.documentElement.setAttribute("data-palette", "emerald");
      toast.success(result.message);
      router.refresh();
    } catch {
      setResetError("Reset database gagal diselesaikan. Periksa koneksi server dan coba lagi.");
    } finally {
      setResetPending(false);
    }
  }

  return (
    <div className="space-y-6">
    <form onSubmit={handleSubmit} className="space-y-6">
      {error && (
        <Alert variant="destructive" role="alert" className="rounded-2xl">
          <CircleAlert className="size-4" />
          <AlertTitle>Pengaturan belum disimpan</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1.4fr)_minmax(320px,0.9fr)]">
        <div className="space-y-6">
          <Card className="gap-0 rounded-[20px] p-5 sm:p-6">
            <div className="flex items-start gap-3 border-b pb-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <School className="size-5" />
              </span>
              <div>
                <h2 className="text-base font-bold">Identitas Aplikasi &amp; Sekolah</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Ditampilkan di sidebar admin, halaman login, ruang peserta, dan header kartu peserta.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="app-name" className="mb-1.5 block text-xs font-semibold">
                  Nama aplikasi <span className="text-destructive">*</span>
                </label>
                <input
                  id="app-name"
                  name="appName"
                  value={appName}
                  onChange={(e) => setAppName(e.target.value)}
                  maxLength={60}
                  required
                  className={inputClass}
                  placeholder="NusaCBT"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Maksimal 60 karakter.</p>
              </div>

              <div>
                <label htmlFor="school-name" className="mb-1.5 block text-xs font-semibold">
                  Nama sekolah
                </label>
                <input
                  id="school-name"
                  name="schoolName"
                  value={schoolName}
                  onChange={(e) => setSchoolName(e.target.value)}
                  maxLength={120}
                  className={inputClass}
                  placeholder="Contoh: SMK Negeri 1 Nusantara"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Opsional, maksimal 120 karakter.</p>
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="app-description" className="mb-1.5 block text-xs font-semibold">
                  Keterangan aplikasi
                </label>
                <input
                  id="app-description"
                  name="appDescription"
                  value={appDescription}
                  onChange={(e) => setAppDescription(e.target.value)}
                  maxLength={160}
                  className={inputClass}
                  placeholder="Platform ujian sekolah"
                />
                <p className="mt-1 text-[11px] text-muted-foreground">Subjudul singkat pada panel dan kartu (maksimal 160 karakter).</p>
              </div>

              <div className="sm:col-span-2">
                <label htmlFor="participant-info" className="mb-1.5 block text-xs font-semibold">
                  Informasi untuk peserta
                </label>
                <textarea
                  id="participant-info"
                  name="participantInfo"
                  value={participantInfo}
                  onChange={(e) => setParticipantInfo(e.target.value)}
                  maxLength={2000}
                  className={textareaClass}
                  placeholder="Contoh: Peserta wajib hadir 15 menit sebelum ujian dimulai. Hubungi pengawas jika ada kendala akun."
                />
                <p className="mt-1 text-[11px] text-muted-foreground">
                  Jika diisi, tampil di halaman login peserta dan ruang peserta (maksimal 2.000 karakter).
                </p>
              </div>
            </div>
          </Card>

          <Card className="gap-0 rounded-[20px] p-5 sm:p-6">
            <div className="flex items-start gap-3 border-b pb-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <Clock className="size-5" />
              </span>
              <div>
                <h2 className="text-base font-bold">Zona Waktu Standar Platform</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Satu pengaturan zona waktu terpusat untuk jadwal tes, pelaksanaan, token, monitoring, lini masa, rekap, dan dasbor.
                </p>
              </div>
            </div>

            <div className="mt-4 max-w-sm">
              <label htmlFor="default-time-zone" className="mb-1.5 block text-xs font-semibold">
                Zona waktu standar
              </label>
              <select
                id="default-time-zone"
                name="defaultTimeZone"
                value={defaultTimeZone}
                onChange={(e) => setDefaultTimeZone(e.target.value as AppTimeZone)}
                className={inputClass}
              >
                {APP_TIME_ZONES.map((zone) => (
                  <option key={zone.id} value={zone.id}>
                    {zone.label} — {zone.detail}
                  </option>
                ))}
              </select>
            </div>
          </Card>

          <Card className="gap-0 rounded-[20px] p-5 sm:p-6">
            <div className="flex items-start gap-3 border-b pb-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <Palette className="size-5" />
              </span>
              <div>
                <h2 className="text-base font-bold">Palet Warna Aplikasi</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Memengaruhi warna aksen utama pada mode terang dan gelap di panel admin maupun ruang peserta.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-3" role="radiogroup" aria-label="Pilihan palet warna">
              {APP_COLOR_PALETTES.map((palette) => {
                const selected = colorPalette === palette.id;
                return (
                  <label
                    key={palette.id}
                    className={`flex cursor-pointer items-center gap-3 rounded-2xl border p-3.5 transition ${
                      selected
                        ? "border-primary bg-accent/60 ring-2 ring-primary/20"
                        : "border-border bg-background hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="colorPalette"
                      value={palette.id}
                      checked={selected}
                      onChange={() => setColorPalette(palette.id)}
                      className="sr-only"
                    />
                    <span
                      aria-hidden="true"
                      className="flex size-9 shrink-0 items-center justify-center rounded-xl text-white shadow-xs"
                      style={{ backgroundColor: palette.swatch }}
                    >
                      {selected && <Check className="size-4" />}
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-semibold text-foreground">{palette.label}</span>
                      <span className="block truncate text-[11px] text-muted-foreground">{palette.detail}</span>
                    </span>
                  </label>
                );
              })}
            </div>
          </Card>

          <Card id="mode-aplikasi" className="gap-0 scroll-mt-24 rounded-[20px] p-5 sm:p-6">
            <div className="flex items-start gap-3 border-b pb-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300">
                <Wrench className="size-5" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-base font-bold">Mode Aplikasi (Production / Dev)</h2>
                  <Badge variant={appMode === "dev" ? "destructive" : "secondary"} className="text-[11px]">
                    {appMode === "dev" ? "Mode Dev" : "Mode Production"}
                  </Badge>
                </div>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Pada Mode Dev, Superadmin dapat menghapus data master yang sudah berdependensi beserta seluruh riwayat terkait, serta mereset seluruh data simulasi. Gunakan Mode Production saat ujian berlangsung.
                </p>
              </div>
            </div>

            {!isSuperuser ? (
              <Alert className="mt-4 rounded-xl">
                <Lock className="size-4" />
                <AlertTitle className="text-xs font-bold">Dibatasi khusus Superadmin</AlertTitle>
                <AlertDescription className="text-xs leading-5">
                  Mode saat ini: <strong>{settings.appMode === "dev" ? "Dev" : "Production"}</strong>. Hanya akun Superadmin yang dapat mengubah mode aplikasi.
                </AlertDescription>
              </Alert>
            ) : (
              <div className="mt-4 space-y-3">
                <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Mode aplikasi">
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
                      appMode === "production"
                        ? "border-primary bg-accent/60 ring-2 ring-primary/20"
                        : "border-border bg-background hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="appMode"
                      value="production"
                      checked={appMode === "production"}
                      onChange={() => setAppMode("production")}
                      className="mt-0.5 size-4 accent-primary"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-foreground">Production (Disarankan)</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        Melindungi data berdependensi dari penghapusan agar riwayat ujian tidak hilang.
                      </span>
                    </span>
                  </label>
                  <label
                    className={`flex cursor-pointer items-start gap-3 rounded-2xl border p-4 transition ${
                      appMode === "dev"
                        ? "border-amber-500 bg-amber-50/70 ring-2 ring-amber-500/20 dark:bg-amber-950/30"
                        : "border-border bg-background hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="radio"
                      name="appMode"
                      value="dev"
                      checked={appMode === "dev"}
                      onChange={() => setAppMode("dev")}
                      className="mt-0.5 size-4 accent-amber-600"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm font-bold text-foreground">Dev (Pengembangan / Uji)</span>
                      <span className="mt-1 block text-xs leading-5 text-muted-foreground">
                        Mengizinkan Superadmin menghapus data beserta dependensinya dan mereset database simulasi.
                      </span>
                    </span>
                  </label>
                </div>

                {appMode === "dev" && (
                  <Alert className="rounded-xl border-amber-300 bg-amber-50 text-amber-950 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100">
                    <AlertTriangle className="size-4 text-amber-600 dark:text-amber-300" />
                    <AlertTitle className="text-xs font-bold">Mode Dev Aktif / Akan Diaktifkan</AlertTitle>
                    <AlertDescription className="text-xs leading-5">
                      Penghapusan data saat Mode Dev tidak dapat dibatalkan. Kembalikan ke Mode Production sebelum pelaksanaan ujian resmi dimulai.
                    </AlertDescription>
                  </Alert>
                )}

                {settings.appMode === "dev" && (
                  <div className="rounded-2xl border border-destructive/40 bg-destructive/5 p-4" data-testid="dev-reset-db-panel">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-sm font-bold text-destructive">Reset Database (Mode Dev)</p>
                        <p className="mt-1 text-xs leading-5 text-muted-foreground">
                          Menghapus seluruh data operasional &amp; simulasi (tahun ajaran, periode, kelas, siswa, mapel, bank soal, tes, pelaksanaan, token, pengerjaan, nilai, dan logo) serta mereset pengaturan aplikasi ke bawaan, sambil mempertahankan akun admin, peran RBAC, dan log audit cadangan.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="destructive"
                        size="sm"
                        disabled={pending || resetPending}
                        onClick={() => {
                          setResetError("");
                          setResetAck(false);
                          setResetPhrase("");
                          setResetOpen(true);
                        }}
                        className="shrink-0 rounded-xl"
                      >
                        <RotateCcw className="size-3.5" /> Reset Database
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card className="gap-0 rounded-[20px] p-5 sm:p-6">
            <div className="flex items-start gap-3 border-b pb-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <ImageIcon className="size-5" />
              </span>
              <div>
                <h2 className="text-base font-bold">Logo Sekolah</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Gunakan berkas PNG atau JPEG statis. Gambar diproses ulang agar aman sebelum disimpan ke database.
                </p>
              </div>
            </div>

            <div className="mt-5 max-w-md space-y-3 rounded-2xl border border-border p-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs font-bold">Logo sekolah</span>
                <Badge variant="outline" className="text-[10px]">
                  {settings.hasLogo && !removeLogo ? "Terpasang" : "Kosong"}
                </Badge>
              </div>
              <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 p-3">
                {settings.hasLogo && !removeLogo ? (
                  /* eslint-disable-next-line @next/next/no-img-element */
                  <img
                    src={`/api/branding/logo?v=${settings.revision}`}
                    alt="Logo sekolah saat ini"
                    className="max-h-18 max-w-full object-contain"
                  />
                ) : (
                  <span className="text-xs text-muted-foreground">
                    {removeLogo ? "Akan dihapus saat disimpan" : "Belum ada logo"}
                  </span>
                )}
              </div>
              <div>
                <label htmlFor="logo-file" className="mb-1 block text-xs font-medium text-muted-foreground">
                  Unggah PNG/JPEG (maks. 1 MiB)
                </label>
                <input
                  ref={logoInputRef}
                  id="logo-file"
                  name="logoFile"
                  type="file"
                  accept="image/png,image/jpeg"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    setLogoFileName(file ? file.name : "");
                    if (file) setRemoveLogo(false);
                  }}
                  className="block w-full text-xs file:mr-3 file:rounded-lg file:border file:border-border file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-semibold hover:file:bg-secondary/80"
                />
                {logoFileName && (
                  <p className="mt-1 flex items-center gap-1 text-[11px] text-primary">
                    <Upload className="size-3" /> Siap unggah: {logoFileName}
                  </p>
                )}
              </div>
              {settings.hasLogo && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setRemoveLogo((prev) => !prev);
                    if (logoInputRef.current) logoInputRef.current.value = "";
                    setLogoFileName("");
                  }}
                  className="w-full rounded-xl text-xs"
                >
                  <Trash2 className="size-3.5" /> {removeLogo ? "Batalkan hapus logo" : "Hapus logo saat ini"}
                </Button>
              )}
            </div>
          </Card>
        </div>

        <div className="space-y-5 xl:sticky xl:top-24 xl:max-h-[calc(100dvh-7rem)] xl:overflow-y-auto">
          <Card className="gap-0 rounded-[20px] p-5 sm:p-6">
            <h2 className="text-base font-bold">Ringkasan Tampilan</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Pratinjau teks yang akan dipakai pada panel admin, halaman login peserta, dan kartu peserta.
            </p>
            <div className="mt-4 rounded-2xl border border-border bg-muted/30 p-4">
              <div className="flex items-center gap-3">
                {settings.hasLogo && !removeLogo ? (
                  <span className="flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-border bg-white p-1">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={`/api/branding/logo?v=${settings.revision}`} alt="Pratinjau logo" className="size-full object-contain" />
                  </span>
                ) : (
                  <span
                    className="flex size-10 shrink-0 items-center justify-center rounded-xl text-sm font-bold text-white"
                    style={{
                      backgroundColor:
                        APP_COLOR_PALETTES.find((item) => item.id === colorPalette)?.swatch ?? "#148a68",
                    }}
                  >
                    {(appName.trim().slice(0, 1) || "N").toUpperCase()}
                  </span>
                )}
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold">{schoolName.trim() || appName.trim() || "NusaCBT"}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {schoolName.trim() ? `${appName.trim() || "NusaCBT"} · ` : ""}
                    {appDescription.trim() || "Platform ujian sekolah"} · {defaultTimeZone}
                  </p>
                </div>
              </div>
              {participantInfo.trim() && (
                <div className="mt-3 rounded-xl border border-border bg-background p-3">
                  <p className="text-[11px] font-semibold text-foreground">Informasi untuk peserta</p>
                  <p className="mt-1 line-clamp-4 whitespace-pre-line break-words text-[11px] leading-5 text-muted-foreground">
                    {participantInfo.trim()}
                  </p>
                </div>
              )}
            </div>

            <Alert className="mt-4 rounded-xl">
              <Info className="size-4" />
              <AlertDescription className="text-xs leading-5">
                Terakhir diperbarui {settings.updatedAt}
                {settings.updatedByUsername ? ` oleh ${settings.updatedByUsername}` : ""} (versi {settings.revision}).
              </AlertDescription>
            </Alert>

            <Button type="submit" disabled={pending || resetPending} className="mt-5 h-11 w-full rounded-xl font-semibold">
              {pending ? <Spinner aria-hidden="true" className="size-4" /> : <Save className="size-4" />}
              {pending ? "Menyimpan pengaturan..." : "Simpan pengaturan aplikasi"}
            </Button>
          </Card>
        </div>
      </div>

      <Dialog open={devConfirmOpen} onOpenChange={(open) => { if (!pending) setDevConfirmOpen(open); }}>
        <DialogContent className="rounded-2xl sm:max-w-md" showCloseButton={!pending}>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-amber-700 dark:text-amber-300">
              <AlertTriangle className="size-5" /> Aktifkan Mode Dev?
            </DialogTitle>
            <DialogDescription>
              Anda akan mengaktifkan <strong>Mode Dev</strong>. Dalam mode ini, Superadmin dapat menghapus Tahun Ajaran, Periode, Kelas/Jurusan, Siswa, Mata Pelajaran, Soal, dan Tes beserta seluruh dependensi dan riwayat nilai terkait, serta mereset seluruh database simulasi.
            </DialogDescription>
          </DialogHeader>
          <p className="text-xs leading-5 text-muted-foreground">
            Jangan biarkan Mode Dev aktif ketika ujian sekolah sesungguhnya sedang berjalan. Pastikan Anda mengembalikannya ke Mode Production setelah selesai.
          </p>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={pending} onClick={() => setDevConfirmOpen(false)}>Batal</Button>
            <Button type="button" variant="destructive" disabled={pending} onClick={() => void submitSave()}>
              {pending && <Spinner aria-hidden="true" className="size-4" />}
              {pending ? "Menyimpan..." : "Ya, aktifkan Mode Dev"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={resetOpen} onOpenChange={(open) => { if (!resetPending) setResetOpen(open); }}>
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] overflow-y-auto rounded-2xl sm:max-w-lg"
          showCloseButton={!resetPending}
          onEscapeKeyDown={(e) => { if (resetPending) e.preventDefault(); }}
          onInteractOutside={(e) => { if (resetPending) e.preventDefault(); }}
        >
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-lg font-bold text-destructive">
              <AlertTriangle className="size-5" /> Konfirmasi Reset Database
            </DialogTitle>
            <DialogDescription>
              Tindakan ini akan menghapus permanen seluruh data operasional dan simulasi, mereset logo &amp; pengaturan aplikasi, dan mengembalikan aplikasi ke <strong>Mode Production</strong>. Akun admin, peran RBAC, sesi admin, dan log audit cadangan tetap dipertahankan.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {resetError && (
              <Alert variant="destructive" role="alert" className="rounded-xl">
                <CircleAlert className="size-4" />
                <AlertDescription>{resetError}</AlertDescription>
              </Alert>
            )}

            <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-xs leading-5 text-muted-foreground">
              Data yang akan dihapus permanen: tahun ajaran, periode ujian, kelas &amp; jurusan, siswa &amp; penempatan, akun peserta, mata pelajaran, bank soal &amp; gambar soal, rancangan &amp; pelaksanaan tes, token, pengerjaan ujian (termasuk yang sedang berjalan), serta nilai akhir.
            </div>

            <label className="flex cursor-pointer items-start gap-2.5 rounded-xl border border-border p-3 text-xs leading-5">
              <input
                type="checkbox"
                checked={resetAck}
                disabled={resetPending}
                onChange={(e) => setResetAck(e.target.checked)}
                className="mt-0.5 size-4 accent-destructive"
              />
              <span>
                Saya memahami bahwa seluruh data operasional akan dihapus permanen dan tidak dapat dikembalikan kecuali dari cadangan ZIP.
              </span>
            </label>

            <div>
              <label htmlFor="reset-db-phrase" className="mb-1.5 block text-xs font-semibold">
                Ketik <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-destructive">RESET DATABASE</code> untuk mengonfirmasi:
              </label>
              <Input
                id="reset-db-phrase"
                value={resetPhrase}
                disabled={resetPending}
                onChange={(e) => setResetPhrase(e.target.value)}
                placeholder="RESET DATABASE"
                autoComplete="off"
                spellCheck={false}
                className="h-10 rounded-xl font-mono"
              />
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" disabled={resetPending} onClick={() => setResetOpen(false)}>
              Batal
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={resetPending || !resetAck || resetPhrase.trim() !== "RESET DATABASE"}
              onClick={() => void handleResetDatabase()}
            >
              {resetPending && <Spinner aria-hidden="true" className="size-4" />}
              {resetPending ? "Mereset database..." : "Ya, reset database sekarang"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </form>

    <Card id="versi-pembaruan" className="gap-0 rounded-[20px] p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-4">
        <div className="flex items-start gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
            <Tag className="size-5" />
          </span>
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold">Versi &amp; Pembaruan Aplikasi</h2>
              <Badge variant="secondary" className="rounded-full font-mono text-xs">{versionInfo.tag}</Badge>
            </div>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Repositori rilis: <span className="font-mono">{versionInfo.repo}</span>
              {versionInfo.commitSha ? ` · build ${versionInfo.commitSha.slice(0, 7)}` : ""}
              {versionInfo.buildDate ? ` (${versionInfo.buildDate.slice(0, 10)})` : ""}. Pemeriksaan hanya berjalan saat tombol diklik (tanpa auto-update).
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="outline"
          disabled={updatePending}
          onClick={() => void handleCheckUpdate()}
          className="h-10 rounded-xl font-semibold"
        >
          {updatePending ? <Spinner aria-hidden="true" className="size-4" /> : <RefreshCw className="size-4" />}
          {updatePending ? "Memeriksa rilis..." : "Cek Pembaruan"}
        </Button>
      </div>

      <div className="pt-4">
        {!updateResult ? (
          <p className="text-xs leading-5 text-muted-foreground">
            Klik <strong>Cek Pembaruan</strong> untuk memeriksa tag rilis terbaru di GitHub. Untuk memperbarui aplikasi secara langsung di PC server Windows (mengganti runtime/kode dan menjalankan migrasi otomatis), gunakan tombol <strong>Cek Update</strong> pada aplikasi <strong>NusaCBT-Server.exe</strong>.
          </p>
        ) : !updateResult.ok ? (
          <Alert variant={updateResult.offline ? "default" : "destructive"} role="status" className="rounded-xl">
            <CircleAlert className="size-4" />
            <AlertTitle className="text-xs font-bold">Pembaruan belum dapat diperiksa</AlertTitle>
            <AlertDescription className="text-xs leading-5">{updateResult.error}</AlertDescription>
          </Alert>
        ) : updateResult.noReleaseYet ? (
          <Alert role="status" className="rounded-xl">
            <Info className="size-4" />
            <AlertTitle className="text-xs font-bold">Belum ada rilis tag di GitHub ({updateResult.currentTag})</AlertTitle>
            <AlertDescription className="text-xs leading-5">
              Anda sedang menjalankan versi <strong>{updateResult.currentTag}</strong>. Buat dan push tag rilis (mis. <code>v1.0.0</code>) agar pembaruan terbit di GitHub Releases.
            </AlertDescription>
          </Alert>
        ) : !updateResult.hasUpdate ? (
          <Alert role="status" className="rounded-xl border-emerald-300 bg-emerald-50/70 text-emerald-950 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100">
            <CheckCircle2 className="size-4 text-emerald-700 dark:text-emerald-300" />
            <AlertTitle className="text-xs font-bold">Sudah menggunakan versi terbaru ({updateResult.currentTag})</AlertTitle>
            <AlertDescription className="text-xs leading-5">
              Rilis terbaru di GitHub adalah <strong>{updateResult.latestTag}</strong>. Tidak ada pembaruan yang perlu dipasang.
            </AlertDescription>
          </Alert>
        ) : (
          <Alert role="status" className="rounded-xl border-blue-300 bg-blue-50/70 text-blue-950 dark:border-blue-800 dark:bg-blue-950/40 dark:text-blue-100">
            <Download className="size-4 text-blue-700 dark:text-blue-300" />
            <AlertTitle className="text-xs font-bold">
              Pembaruan tersedia: {updateResult.latestTag} (terpasang {updateResult.currentTag})
            </AlertTitle>
            <AlertDescription className="space-y-3 text-xs leading-5">
              <p>
                {updateResult.releaseName && <strong>{updateResult.releaseName}</strong>}
                {updateResult.publishedAt ? ` · Dirilis ${updateResult.publishedAt.slice(0, 10)}` : ""}
              </p>
              {updateResult.notes && (
                <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-lg border border-blue-200 bg-background/80 p-3 font-sans text-[11px] leading-5 text-foreground dark:border-blue-800">
                  {updateResult.notes}
                </pre>
              )}
              <p>
                Buka <strong>NusaCBT-Server.exe</strong> di PC server Windows lalu klik <strong>Cek Update</strong> → <strong>Perbarui Sekarang</strong> agar aplikasi memperbarui berkas program dan migrasi database secara otomatis tanpa menghapus pengaturan maupun data ujian.
              </p>
              <div className="flex flex-wrap gap-2">
                {updateResult.assets.installer && (
                  <Button asChild size="sm" variant="default" className="h-8 rounded-lg text-xs">
                    <a href={updateResult.assets.installer.url} target="_blank" rel="noopener noreferrer">
                      <Download className="size-3.5" /> Unduh Installer Windows ({updateResult.assets.installer.name})
                    </a>
                  </Button>
                )}
                {updateResult.assets.portableZip && (
                  <Button asChild size="sm" variant="outline" className="h-8 rounded-lg text-xs">
                    <a href={updateResult.assets.portableZip.url} target="_blank" rel="noopener noreferrer">
                      <Download className="size-3.5" /> Unduh Paket Portable ZIP
                    </a>
                  </Button>
                )}
                <Button asChild size="sm" variant="outline" className="h-8 rounded-lg text-xs">
                  <a href={updateResult.releaseUrl} target="_blank" rel="noopener noreferrer">
                    <ExternalLink className="size-3.5" /> Lihat Catatan Rilis di GitHub
                  </a>
                </Button>
              </div>
            </AlertDescription>
          </Alert>
        )}
      </div>
    </Card>
    </div>
  );
}
