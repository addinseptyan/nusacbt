"use client";

import { Check, CircleAlert, Image as ImageIcon, Info, Palette, Save, School, Trash2, Upload } from "lucide-react";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { toast } from "sonner";

import { saveAppSettingsAction } from "@/app/pengaturan/aplikasi/actions";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { AdminAppSettings } from "@/lib/app-settings-types";
import { APP_COLOR_PALETTES, type ColorPaletteId } from "@/lib/app-settings-validation.mjs";

const inputClass =
  "h-10 w-full rounded-xl border border-input bg-background px-3 text-sm text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";
const textareaClass =
  "min-h-28 w-full rounded-xl border border-input bg-background px-3 py-2.5 text-sm text-foreground outline-none transition focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30";

export function AppSettingsManager({ initialSettings }: { initialSettings: AdminAppSettings }) {
  const router = useRouter();
  const [settings, setSettings] = useState(initialSettings);
  const [appName, setAppName] = useState(initialSettings.appName);
  const [appDescription, setAppDescription] = useState(initialSettings.appDescription);
  const [schoolName, setSchoolName] = useState(initialSettings.schoolName);
  const [participantInfo, setParticipantInfo] = useState(initialSettings.participantInfo);
  const [colorPalette, setColorPalette] = useState<ColorPaletteId>(initialSettings.colorPalette);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [removeLetterhead, setRemoveLetterhead] = useState(false);
  const [logoFileName, setLogoFileName] = useState("");
  const [letterheadFileName, setLetterheadFileName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");

  const logoInputRef = useRef<HTMLInputElement>(null);
  const letterheadInputRef = useRef<HTMLInputElement>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    setError("");

    const formData = new FormData();
    formData.set("appName", appName);
    formData.set("appDescription", appDescription);
    formData.set("schoolName", schoolName);
    formData.set("participantInfo", participantInfo);
    formData.set("colorPalette", colorPalette);
    formData.set("revision", settings.revision);
    if (removeLogo) formData.set("removeLogo", "1");
    if (removeLetterhead) formData.set("removeLetterhead", "1");

    const logoFile = logoInputRef.current?.files?.[0];
    if (logoFile && logoFile.size > 0) formData.set("logoFile", logoFile);
    const letterheadFile = letterheadInputRef.current?.files?.[0];
    if (letterheadFile && letterheadFile.size > 0) formData.set("letterheadFile", letterheadFile);

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
      setRemoveLogo(false);
      setRemoveLetterhead(false);
      setLogoFileName("");
      setLetterheadFileName("");
      if (logoInputRef.current) logoInputRef.current.value = "";
      if (letterheadInputRef.current) letterheadInputRef.current.value = "";
      document.documentElement.setAttribute("data-palette", result.settings.colorPalette);
      toast.success(result.message);
      router.refresh();
    } catch {
      setError("Pengaturan gagal disimpan. Periksa koneksi server dan coba lagi.");
    } finally {
      setPending(false);
    }
  }

  return (
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

          <Card className="gap-0 rounded-[20px] p-5 sm:p-6">
            <div className="flex items-start gap-3 border-b pb-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-accent text-accent-foreground">
                <ImageIcon className="size-5" />
              </span>
              <div>
                <h2 className="text-base font-bold">Logo Sekolah &amp; Gambar Kop Surat</h2>
                <p className="mt-1 text-xs leading-5 text-muted-foreground">
                  Gunakan berkas PNG atau JPEG statis. Gambar diproses ulang agar aman sebelum disimpan ke database.
                </p>
              </div>
            </div>

            <div className="mt-5 grid gap-6 sm:grid-cols-2">
              <div className="space-y-3 rounded-2xl border border-border p-4">
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

              <div className="space-y-3 rounded-2xl border border-border p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-bold">Gambar kop surat</span>
                  <Badge variant="outline" className="text-[10px]">
                    {settings.hasLetterhead && !removeLetterhead ? "Terpasang" : "Kosong"}
                  </Badge>
                </div>
                <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-border bg-muted/30 p-3">
                  {settings.hasLetterhead && !removeLetterhead ? (
                    /* eslint-disable-next-line @next/next/no-img-element */
                    <img
                      src={`/api/branding/letterhead?v=${settings.revision}`}
                      alt="Kop surat saat ini"
                      className="max-h-18 max-w-full object-contain"
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {removeLetterhead ? "Akan dihapus saat disimpan" : "Belum ada kop surat"}
                    </span>
                  )}
                </div>
                <div>
                  <label htmlFor="letterhead-file" className="mb-1 block text-xs font-medium text-muted-foreground">
                    Unggah PNG/JPEG (maks. 2 MiB)
                  </label>
                  <input
                    ref={letterheadInputRef}
                    id="letterhead-file"
                    name="letterheadFile"
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      setLetterheadFileName(file ? file.name : "");
                      if (file) setRemoveLetterhead(false);
                    }}
                    className="block w-full text-xs file:mr-3 file:rounded-lg file:border file:border-border file:bg-secondary file:px-3 file:py-1.5 file:text-xs file:font-semibold hover:file:bg-secondary/80"
                  />
                  {letterheadFileName && (
                    <p className="mt-1 flex items-center gap-1 text-[11px] text-primary">
                      <Upload className="size-3" /> Siap unggah: {letterheadFileName}
                    </p>
                  )}
                </div>
                {settings.hasLetterhead && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setRemoveLetterhead((prev) => !prev);
                      if (letterheadInputRef.current) letterheadInputRef.current.value = "";
                      setLetterheadFileName("");
                    }}
                    className="w-full rounded-xl text-xs"
                  >
                    <Trash2 className="size-3.5" /> {removeLetterhead ? "Batalkan hapus kop" : "Hapus kop saat ini"}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        </div>

        <div className="space-y-5">
          <Card className="gap-0 rounded-[20px] p-5 sm:p-6">
            <h2 className="text-base font-bold">Ringkasan Tampilan</h2>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">
              Pratinjau teks yang akan dipakai pada panel admin, halaman login peserta, dan kartu peserta.
            </p>
            <div className="mt-4 rounded-2xl border border-border bg-muted/30 p-4">
              {settings.hasLetterhead && !removeLetterhead && (
                <div className="mb-3 border-b border-border pb-2 text-center">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/branding/letterhead?v=${settings.revision}`}
                    alt="Pratinjau kop surat"
                    className="mx-auto max-h-12 object-contain"
                  />
                </div>
              )}
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
                    {appDescription.trim() || "Platform ujian sekolah"}
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

            <Button type="submit" disabled={pending} className="mt-5 h-11 w-full rounded-xl font-semibold">
              <Save className="size-4" /> {pending ? "Menyimpan pengaturan..." : "Simpan pengaturan aplikasi"}
            </Button>
          </Card>
        </div>
      </div>
    </form>
  );
}
