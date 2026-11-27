using System.Diagnostics;
using System.IO.Compression;

namespace NusaCBT.Server;

internal sealed class UpdateDialog : Form
{
    private readonly bool _checkOnlineOnOpen;
    private readonly Func<Task> _stopServerBeforeSwap;
    private readonly Label _currentVerLabel = new() { AutoSize = true };
    private readonly Label _onlineStatusLabel = new() { AutoSize = true, MaximumSize = new Size(520, 0) };
    private readonly TextBox _releaseNotesBox = new() { Multiline = true, ReadOnly = true, ScrollBars = ScrollBars.Vertical, Dock = DockStyle.Fill, Height = 110 };
    private readonly Button _checkOnlineBtn = new() { Text = "Periksa Rilis Terbaru", AutoSize = true, Padding = new Padding(10, 5, 10, 5) };
    private readonly Button _installOnlineBtn = new() { Text = "Unduh & Perbarui Sekarang", AutoSize = true, Enabled = false, Padding = new Padding(10, 5, 10, 5) };
    private readonly Button _openReleasePageBtn = new() { Text = "Buka Halaman Rilis", AutoSize = true, Enabled = false, Padding = new Padding(10, 5, 10, 5) };
    private readonly TextBox _zipPathBox = new() { ReadOnly = true, Dock = DockStyle.Fill };
    private readonly Button _browseZipBtn = new() { Text = "Pilih ZIP...", AutoSize = true };
    private readonly Button _installZipBtn = new() { Text = "Perbarui dari ZIP Ini", AutoSize = true, Enabled = false, Padding = new Padding(10, 5, 10, 5) };
    private readonly ProgressBar _progressBar = new() { Dock = DockStyle.Bottom, Height = 14, Style = ProgressBarStyle.Blocks };
    private ReleaseCheckResult? _latestResult;
    private bool _busy;

    public UpdateDialog(bool checkOnlineOnOpen, Func<Task> stopServerBeforeSwap)
    {
        _checkOnlineOnOpen = checkOnlineOnOpen;
        _stopServerBeforeSwap = stopServerBeforeSwap;

        Text = "Pembaruan Aplikasi NusaCBT Server";
        StartPosition = FormStartPosition.CenterParent;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(580, 510);

        var root = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(16),
            ColumnCount = 1,
            RowCount = 4,
        };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 60));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 40));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        _currentVerLabel.Text = $"Versi Terpasang: {VersionUtils.CurrentTag}   |   Repositori: {VersionUtils.GitHubRepo}";
        _currentVerLabel.Font = new Font(Font, FontStyle.Bold);
        root.Controls.Add(_currentVerLabel, 0, 0);

        var onlineGroup = new GroupBox { Text = "1. Pembaruan Online via GitHub Releases (Manual)", Dock = DockStyle.Fill, Padding = new Padding(12) };
        var onlineLayout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 1, RowCount = 3 };
        onlineLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        onlineLayout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        onlineLayout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        _onlineStatusLabel.Text = "Klik 'Periksa Rilis Terbaru' untuk memeriksa pembaruan (tidak berjalan otomatis di latar belakang).";
        onlineLayout.Controls.Add(_onlineStatusLabel, 0, 0);
        onlineLayout.Controls.Add(_releaseNotesBox, 0, 1);

        var onlineBtns = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true };
        _checkOnlineBtn.Click += async (_, _) => await CheckOnlineAsync();
        _installOnlineBtn.Click += async (_, _) => await InstallFromOnlineAsync();
        _openReleasePageBtn.Click += (_, _) =>
        {
            if (_latestResult is not null && VersionUtils.IsAllowedGitHubUrl(_latestResult.ReleaseUrl))
            {
                Process.Start(new ProcessStartInfo(_latestResult.ReleaseUrl) { UseShellExecute = true });
            }
        };
        onlineBtns.Controls.Add(_checkOnlineBtn);
        onlineBtns.Controls.Add(_installOnlineBtn);
        onlineBtns.Controls.Add(_openReleasePageBtn);
        onlineLayout.Controls.Add(onlineBtns, 0, 2);
        onlineGroup.Controls.Add(onlineLayout);
        root.Controls.Add(onlineGroup, 0, 1);

        var offlineGroup = new GroupBox { Text = "2. Pembaruan Offline dari File Paket Portable ZIP", Dock = DockStyle.Fill, Padding = new Padding(12) };
        var offlineLayout = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 2, RowCount = 3 };
        offlineLayout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        offlineLayout.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        var offlineHint = new Label
        {
            Text = "Gunakan paket NusaCBT-vX.Y.Z-win64-portable.zip untuk server tanpa internet. Data database, .env.local, dan kunci enkripsi tetap aman.",
            AutoSize = true,
            ForeColor = Color.DimGray,
        };
        offlineLayout.Controls.Add(offlineHint, 0, 0);
        offlineLayout.SetColumnSpan(offlineHint, 2);

        offlineLayout.Controls.Add(_zipPathBox, 0, 1);
        _browseZipBtn.Click += (_, _) => BrowseOfflineZip();
        offlineLayout.Controls.Add(_browseZipBtn, 1, 1);

        _installZipBtn.Click += async (_, _) => await InstallFromZipFileAsync(_zipPathBox.Text, expectedSha256: null);
        offlineLayout.Controls.Add(_installZipBtn, 0, 2);
        offlineGroup.Controls.Add(offlineLayout);
        root.Controls.Add(offlineGroup, 0, 2);

        var closePanel = new FlowLayoutPanel { Dock = DockStyle.Fill, FlowDirection = FlowDirection.RightToLeft, AutoSize = true };
        var closeBtn = new Button { Text = "Tutup", AutoSize = true, Padding = new Padding(12, 5, 12, 5) };
        closeBtn.Click += (_, _) => Close();
        closePanel.Controls.Add(closeBtn);
        root.Controls.Add(closePanel, 0, 3);

        Controls.Add(root);
        Controls.Add(_progressBar);

        Shown += async (_, _) =>
        {
            if (_checkOnlineOnOpen)
            {
                await CheckOnlineAsync();
            }
        };
    }

    private void SetBusy(bool busy)
    {
        _busy = busy;
        _checkOnlineBtn.Enabled = !busy;
        _browseZipBtn.Enabled = !busy;
        _installZipBtn.Enabled = !busy && File.Exists(_zipPathBox.Text);
        _installOnlineBtn.Enabled = !busy && (_latestResult?.HasUpdate ?? false) && !string.IsNullOrEmpty(_latestResult?.PortableZipUrl);
        _progressBar.Style = busy ? ProgressBarStyle.Marquee : ProgressBarStyle.Blocks;
    }

    private async Task CheckOnlineAsync()
    {
        if (_busy) return;
        SetBusy(true);
        _onlineStatusLabel.ForeColor = Color.RoyalBlue;
        _onlineStatusLabel.Text = "Menghubungi GitHub Releases...";
        _releaseNotesBox.Clear();
        _openReleasePageBtn.Enabled = false;

        try
        {
            using var cts = new CancellationTokenSource(TimeSpan.FromSeconds(15));
            _latestResult = await VersionUtils.CheckLatestReleaseAsync(cts.Token);

            if (!_latestResult.Ok)
            {
                _onlineStatusLabel.ForeColor = Color.DarkRed;
                _onlineStatusLabel.Text = _latestResult.ErrorMessage ?? "Gagal memeriksa pembaruan.";
                return;
            }

            _openReleasePageBtn.Enabled = true;

            if (_latestResult.NoReleaseYet)
            {
                _onlineStatusLabel.ForeColor = Color.DimGray;
                _onlineStatusLabel.Text = $"Belum ada rilis tag di GitHub (versi lokal {_latestResult.CurrentTag}).";
                return;
            }

            _releaseNotesBox.Text = string.IsNullOrWhiteSpace(_latestResult.Notes)
                ? "(Tidak ada catatan rilis tambahan.)"
                : _latestResult.Notes.Replace("\n", Environment.NewLine);

            if (!_latestResult.HasUpdate)
            {
                _onlineStatusLabel.ForeColor = Color.DarkGreen;
                _onlineStatusLabel.Text = $"Anda sudah memakai versi terbaru ({_latestResult.CurrentTag}; rilis GitHub {_latestResult.LatestTag}).";
                return;
            }

            _onlineStatusLabel.ForeColor = Color.DarkBlue;
            if (string.IsNullOrEmpty(_latestResult.PortableZipUrl))
            {
                _onlineStatusLabel.Text = $"Versi baru {_latestResult.LatestTag} tersedia, namun paket ZIP portable belum dilampirkan di aset rilis.";
            }
            else
            {
                var mb = _latestResult.PortableZipSize > 0 ? $" ({_latestResult.PortableZipSize / (1024d * 1024d):0.0} MB)" : "";
                _onlineStatusLabel.Text = $"Pembaruan tersedia: {_latestResult.LatestTag}{mb}. Siap diunduh & dipasang.";
            }
        }
        finally
        {
            SetBusy(false);
        }
    }

    private void BrowseOfflineZip()
    {
        using var ofd = new OpenFileDialog
        {
            Title = "Pilih Paket Update NusaCBT Portable ZIP",
            Filter = "Paket Update ZIP (*.zip)|*.zip",
            CheckFileExists = true,
        };
        if (ofd.ShowDialog(this) == DialogResult.OK)
        {
            _zipPathBox.Text = ofd.FileName;
            _installZipBtn.Enabled = !_busy && File.Exists(ofd.FileName);
        }
    }

    private async Task InstallFromOnlineAsync()
    {
        if (_latestResult is null || string.IsNullOrEmpty(_latestResult.PortableZipUrl) || string.IsNullOrEmpty(_latestResult.PortableZipName))
        {
            return;
        }
        if (!VersionUtils.IsAllowedGitHubUrl(_latestResult.PortableZipUrl))
        {
            MessageBox.Show(this, "URL aset rilis tidak berasal dari domain GitHub resmi.", "Keamanan Pembaruan", MessageBoxButtons.OK, MessageBoxIcon.Error);
            return;
        }

        if (string.IsNullOrEmpty(_latestResult.ChecksumsUrl) || !VersionUtils.IsAllowedGitHubUrl(_latestResult.ChecksumsUrl))
        {
            var proceedWithoutHash = MessageBox.Show(
                this,
                "File SHA256SUMS.txt tidak ditemukan pada rilis ini. Tetap lanjutkan mengunduh paket pembaruan?",
                "Verifikasi Checksum",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning);
            if (proceedWithoutHash != DialogResult.Yes) return;
        }

        SetBusy(true);
        _onlineStatusLabel.ForeColor = Color.RoyalBlue;
        _onlineStatusLabel.Text = $"Mengunduh {_latestResult.PortableZipName}...";

        var tempDir = Path.Combine(Path.GetTempPath(), $"nusacbt-dl-{Guid.NewGuid():N}");
        Directory.CreateDirectory(tempDir);
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromMinutes(10) };
            http.DefaultRequestHeaders.UserAgent.ParseAdd($"NusaCBT-Server/{VersionUtils.CurrentVersion}");

            string? expectedSha = null;
            if (!string.IsNullOrEmpty(_latestResult.ChecksumsUrl))
            {
                var sumsText = await http.GetStringAsync(_latestResult.ChecksumsUrl);
                expectedSha = VersionUtils.ExtractExpectedSha256(sumsText, _latestResult.PortableZipName);
            }

            var zipTarget = Path.Combine(tempDir, _latestResult.PortableZipName);
            using (var stream = await http.GetStreamAsync(_latestResult.PortableZipUrl))
            using (var fs = File.Create(zipTarget))
            {
                await stream.CopyToAsync(fs);
            }

            SetBusy(false);
            await InstallFromZipFileAsync(zipTarget, expectedSha);
        }
        catch (Exception ex)
        {
            SetBusy(false);
            MessageBox.Show(this, $"Gagal mengunduh pembaruan: {ex.Message}", "Pembaruan Gagal", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private async Task InstallFromZipFileAsync(string zipPath, string? expectedSha256)
    {
        if (!File.Exists(zipPath)) return;

        var activeAttempts = await PreflightRunner.GetActiveExamsCountAsync();
        if (activeAttempts > 0)
        {
            var confirmExam = MessageBox.Show(
                this,
                $"PERINGATAN: Saat ini terdapat {activeAttempts} sesi pengerjaan ujian berstatus aktif!\n\nMemperbarui sekarang akan menghentikan server dan memutus koneksi peserta. Apakah Anda yakin tetap ingin melanjutkan?",
                "Ujian Sedang Berlangsung",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button2);
            if (confirmExam != DialogResult.Yes) return;
        }

        var confirmInstall = MessageBox.Show(
            this,
            "Server akan dihentikan sementara, berkas aplikasi dan runtime akan diganti, lalu peluncur dimulai ulang otomatis. Data database, .env.local, dan kunci enkripsi tidak akan diubah.\n\nLanjutkan pembaruan sekarang?",
            "Konfirmasi Pembaruan",
            MessageBoxButtons.YesNo,
            MessageBoxIcon.Question);
        if (confirmInstall != DialogResult.Yes) return;

        SetBusy(true);
        _onlineStatusLabel.ForeColor = Color.RoyalBlue;
        _onlineStatusLabel.Text = "Memverifikasi dan mengekstrak paket pembaruan...";

        var stageRoot = Path.Combine(Path.GetTempPath(), $"nusacbt-stage-{Guid.NewGuid():N}");
        try
        {
            if (string.IsNullOrEmpty(expectedSha256))
            {
                var sidecar = Path.Combine(Path.GetDirectoryName(zipPath) ?? "", "SHA256SUMS.txt");
                if (File.Exists(sidecar))
                {
                    var sums = await File.ReadAllTextAsync(sidecar);
                    expectedSha256 = VersionUtils.ExtractExpectedSha256(sums, Path.GetFileName(zipPath));
                }
            }

            if (!string.IsNullOrEmpty(expectedSha256))
            {
                var actualSha = VersionUtils.ComputeFileSha256(zipPath);
                if (!actualSha.Equals(expectedSha256, StringComparison.OrdinalIgnoreCase))
                {
                    throw new InvalidOperationException($"Checksum SHA-256 tidak cocok!\nDiharapkan: {expectedSha256}\nAktual: {actualSha}");
                }
            }

            Directory.CreateDirectory(stageRoot);
            ZipFile.ExtractToDirectory(zipPath, stageRoot, overwriteFiles: true);

            var payloadRoot = ResolvePayloadRoot(stageRoot);
            if (payloadRoot is null)
            {
                throw new InvalidOperationException("Struktur paket ZIP tidak valid. Pastikan di dalamnya terdapat NusaCBT-Server.exe, runtime\\node.exe, dan app\\server-entry.mjs.");
            }

            await _stopServerBeforeSwap();

            var psScript = BuildSwapPowerShellScript(
                Environment.ProcessId,
                payloadRoot,
                AppPaths.BaseDir,
                Path.Combine(AppPaths.BaseDir, "NusaCBT-Server.exe"),
                stageRoot);

            var scriptPath = Path.Combine(Path.GetTempPath(), $"nusacbt-updater-{Guid.NewGuid():N}.ps1");
            await File.WriteAllTextAsync(scriptPath, psScript);

            var needsElevation = !IsDirectoryWritable(AppPaths.BaseDir);
            var psi = new ProcessStartInfo("powershell.exe", $"-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File \"{scriptPath}\"")
            {
                UseShellExecute = true,
                WindowStyle = ProcessWindowStyle.Hidden,
                Verb = needsElevation ? "runas" : "",
            };
            Process.Start(psi);
            Application.Exit();
        }
        catch (Exception ex)
        {
            try { if (Directory.Exists(stageRoot)) Directory.Delete(stageRoot, true); } catch { }
            SetBusy(false);
            MessageBox.Show(this, $"Pembaruan gagal disiapkan:\n{ex.Message}", "Pembaruan Gagal", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
    }

    private static string? ResolvePayloadRoot(string extractedRoot)
    {
        if (IsValidPayloadDir(extractedRoot)) return extractedRoot;
        foreach (var subDir in Directory.GetDirectories(extractedRoot))
        {
            if (IsValidPayloadDir(subDir)) return subDir;
        }
        return null;
    }

    private static bool IsValidPayloadDir(string dir) =>
        File.Exists(Path.Combine(dir, "NusaCBT-Server.exe")) &&
        File.Exists(Path.Combine(dir, "runtime", "node.exe")) &&
        File.Exists(Path.Combine(dir, "app", "server-entry.mjs"));

    private static bool IsDirectoryWritable(string dir)
    {
        try
        {
            var probe = Path.Combine(dir, $".write-probe-{Guid.NewGuid():N}");
            using (File.Create(probe)) { }
            File.Delete(probe);
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static string BuildSwapPowerShellScript(int waitPid, string srcDir, string destDir, string exeToRelaunch, string stageRoot)
    {
        static string Esc(string s) => s.Replace("'", "''");
        return $$"""
$ErrorActionPreference = 'Stop'
$waitPid = {{waitPid}}
$srcDir = '{{Esc(srcDir)}}'
$destDir = '{{Esc(destDir)}}'
$exePath = '{{Esc(exeToRelaunch)}}'
$stageRoot = '{{Esc(stageRoot)}}'

for ($i = 0; $i -lt 60; $i++) {
  if (-not (Get-Process -Id $waitPid -ErrorAction SilentlyContinue)) { break }
  Start-Sleep -Milliseconds 300
}
Start-Sleep -Milliseconds 400

$appTarget = Join-Path $destDir 'app'
$appBak = Join-Path $destDir 'app.bak'
$rtTarget = Join-Path $destDir 'runtime'
$rtBak = Join-Path $destDir 'runtime.bak'
$exeTarget = Join-Path $destDir 'NusaCBT-Server.exe'
$exeBak = Join-Path $destDir 'NusaCBT-Server.exe.bak'

try {
  if (Test-Path $appBak) { Remove-Item $appBak -Recurse -Force }
  if (Test-Path $rtBak) { Remove-Item $rtBak -Recurse -Force }
  if (Test-Path $exeBak) { Remove-Item $exeBak -Force }

  if (Test-Path $appTarget) { Move-Item $appTarget $appBak -Force }
  if (Test-Path $rtTarget) { Move-Item $rtTarget $rtBak -Force }
  if (Test-Path $exeTarget) { Move-Item $exeTarget $exeBak -Force }

  Copy-Item (Join-Path $srcDir 'app') $appTarget -Recurse -Force
  Copy-Item (Join-Path $srcDir 'runtime') $rtTarget -Recurse -Force
  Copy-Item (Join-Path $srcDir 'NusaCBT-Server.exe') $exeTarget -Force

  if (Test-Path $appBak) { Remove-Item $appBak -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path $rtBak) { Remove-Item $rtBak -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path $exeBak) { Remove-Item $exeBak -Force -ErrorAction SilentlyContinue }
} catch {
  if (-not (Test-Path $appTarget) -and (Test-Path $appBak)) { Move-Item $appBak $appTarget -Force -ErrorAction SilentlyContinue }
  if (-not (Test-Path $rtTarget) -and (Test-Path $rtBak)) { Move-Item $rtBak $rtTarget -Force -ErrorAction SilentlyContinue }
  if (-not (Test-Path $exeTarget) -and (Test-Path $exeBak)) { Move-Item $exeBak $exeTarget -Force -ErrorAction SilentlyContinue }
} finally {
  if (Test-Path $stageRoot) { Remove-Item $stageRoot -Recurse -Force -ErrorAction SilentlyContinue }
  if (Test-Path $exePath) { Start-Process -FilePath $exePath }
  Remove-Item $PSCommandPath -Force -ErrorAction SilentlyContinue
}
""";
    }
}
