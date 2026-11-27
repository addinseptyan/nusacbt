using System.Diagnostics;
using System.Text;
using System.Text.Json;

namespace NusaCBT.Server;

internal sealed class LauncherSettings
{
    public int Port { get; set; } = 3000;
    public bool AutoOpenBrowser { get; set; } = true;
}

internal sealed class MainForm : Form
{
    private enum ServerRunState { Stopped, Starting, Running }

    private readonly JobObject _job = new();
    private readonly NotifyIcon _trayIcon = new();
    private readonly Label _versionBadge = new() { AutoSize = true, BackColor = Color.FromArgb(226, 232, 240), Padding = new Padding(8, 4, 8, 4) };
    private readonly Label _stateBadge = new() { AutoSize = true, Padding = new Padding(10, 4, 10, 4), ForeColor = Color.White };

    private readonly Label _depRuntimeLbl = new() { AutoSize = true };
    private readonly Label _depPostgresLbl = new() { AutoSize = true };
    private readonly Label _depDbLbl = new() { AutoSize = true };
    private readonly Label _depConfigLbl = new() { AutoSize = true };
    private readonly Label _depSchemaLbl = new() { AutoSize = true };
    private readonly Label _depPortLbl = new() { AutoSize = true };

    private readonly Button _startPgBtn = new() { Text = "Nyalakan PostgreSQL", AutoSize = true, Enabled = false };
    private readonly Button _downloadPgBtn = new() { Text = "Unduh PostgreSQL", AutoSize = true, Visible = false };
    private readonly Button _setupBtn = new() { Text = "Setup Awal / DB", AutoSize = true };
    private readonly Button _migrateBtn = new() { Text = "Jalankan Migrasi", AutoSize = true, Enabled = false };
    private readonly NumericUpDown _portInput = new() { Minimum = 80, Maximum = 65535, Value = 3000, Width = 80 };
    private readonly Button _firewallBtn = new() { Text = "Izinkan Port Firewall", AutoSize = true };

    private readonly Button _startBtn = new() { Text = "Mulai Server", AutoSize = true, Padding = new Padding(14, 7, 14, 7) };
    private readonly Button _stopBtn = new() { Text = "Hentikan Server", AutoSize = true, Enabled = false, Padding = new Padding(14, 7, 14, 7) };
    private readonly Button _openDashBtn = new() { Text = "Buka Dashboard Admin", AutoSize = true, Enabled = false, Padding = new Padding(10, 7, 10, 7) };
    private readonly Button _copyStudentUrlBtn = new() { Text = "Salin Link Peserta", AutoSize = true, Enabled = false, Padding = new Padding(10, 7, 10, 7) };
    private readonly Button _refreshBtn = new() { Text = "Refresh Status", AutoSize = true, Padding = new Padding(10, 7, 10, 7) };
    private readonly Button _checkUpdateBtn = new() { Text = "Cek Update", AutoSize = true, Padding = new Padding(10, 7, 10, 7) };
    private readonly Button _offlineZipBtn = new() { Text = "Update dari ZIP", AutoSize = true, Padding = new Padding(10, 7, 10, 7) };
    private readonly CheckBox _autoOpenCheck = new() { Text = "Buka browser otomatis saat server siap", Checked = true, AutoSize = true };

    private readonly Label _urlInfoLabel = new() { AutoSize = true, ForeColor = Color.FromArgb(30, 64, 175) };
    private readonly TextBox _logBox = new()
    {
        Multiline = true,
        ReadOnly = true,
        ScrollBars = ScrollBars.Vertical,
        Dock = DockStyle.Fill,
        BackColor = Color.FromArgb(15, 23, 42),
        ForeColor = Color.FromArgb(226, 232, 240),
        Font = new Font("Consolas", 9F),
    };

    private LauncherSettings _settings = new();
    private PreflightStatus? _lastStatus;
    private List<PostgresServiceInfo> _pgServices = [];
    private Process? _serverProcess;
    private ServerRunState _runState = ServerRunState.Stopped;
    private StreamWriter? _logWriter;
    private bool _forceExit;

    public MainForm()
    {
        LoadSettings();

        Text = $"NusaCBT Server Launcher ({VersionUtils.CurrentTag})";
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(920, 680);
        MinimumSize = new Size(820, 600);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

        BuildUi();
        ConfigureTray();
        UpdateRunStateUi(ServerRunState.Stopped);

        Shown += async (_, _) => await RefreshPreflightAsync();
        FormClosing += OnMainFormClosing;
        FormClosed += (_, _) =>
        {
            _trayIcon.Visible = false;
            _trayIcon.Dispose();
            _job.Dispose();
        };
    }

    private void BuildUi()
    {
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(14), ColumnCount = 1, RowCount = 5 };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        // 1. Header
        var header = new Panel { Dock = DockStyle.Fill, Height = 46 };
        var titleLbl = new Label { Text = "NusaCBT Server PC", Font = new Font(Font.FontFamily, 14F, FontStyle.Bold), AutoSize = true, Location = new Point(0, 6) };
        _versionBadge.Text = VersionUtils.CurrentTag;
        _versionBadge.Location = new Point(195, 8);
        _stateBadge.Location = new Point(275, 8);

        var headerRight = new FlowLayoutPanel { Dock = DockStyle.Right, AutoSize = true, FlowDirection = FlowDirection.RightToLeft };
        _offlineZipBtn.Click += (_, _) => OpenUpdateDialog(checkOnlineImmediately: false);
        _checkUpdateBtn.Click += (_, _) => OpenUpdateDialog(checkOnlineImmediately: true);
        headerRight.Controls.Add(_offlineZipBtn);
        headerRight.Controls.Add(_checkUpdateBtn);

        header.Controls.Add(titleLbl);
        header.Controls.Add(_versionBadge);
        header.Controls.Add(_stateBadge);
        header.Controls.Add(headerRight);
        root.Controls.Add(header, 0, 0);

        // 2. Checklist Dependensi
        var depBox = new GroupBox { Text = "Pemeriksaan Dependensi & Kesiapan Server", Dock = DockStyle.Fill, Padding = new Padding(12) };
        var depTable = new TableLayoutPanel { Dock = DockStyle.Fill, ColumnCount = 3, AutoSize = true };
        depTable.ColumnStyles.Add(new ColumnStyle(SizeType.Absolute, 210));
        depTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        depTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        AddDepRow(depTable, "1. Runtime Node & App", _depRuntimeLbl, new Label { AutoSize = true });

        var pgActionPanel = new FlowLayoutPanel { AutoSize = true, Margin = Padding.Empty };
        _startPgBtn.Click += async (_, _) => await StartPostgresClickedAsync();
        _downloadPgBtn.Click += (_, _) => Process.Start(new ProcessStartInfo("https://www.enterprisedb.com/downloads/postgres-postgresql-downloads") { UseShellExecute = true });
        pgActionPanel.Controls.Add(_startPgBtn);
        pgActionPanel.Controls.Add(_downloadPgBtn);
        AddDepRow(depTable, "2. Service PostgreSQL", _depPostgresLbl, pgActionPanel);

        AddDepRow(depTable, "3. Koneksi & UTF-8 DB", _depDbLbl, new Label { AutoSize = true });

        _setupBtn.Click += async (_, _) => await OpenSetupWizardAsync();
        AddDepRow(depTable, "4. Config .env & Kunci", _depConfigLbl, _setupBtn);

        _migrateBtn.Click += async (_, _) => await RunMigrateClickedAsync();
        AddDepRow(depTable, "5. Skema DB & Admin", _depSchemaLbl, _migrateBtn);

        var portPanel = new FlowLayoutPanel { AutoSize = true, Margin = Padding.Empty };
        _portInput.Value = _settings.Port;
        _portInput.ValueChanged += (_, _) =>
        {
            _settings.Port = (int)_portInput.Value;
            SaveSettings();
            UpdateNetworkUrlInfo();
        };
        _firewallBtn.Click += async (_, _) =>
        {
            var (ok, msg) = await WindowsSystemHelper.AllowPortInFirewallAsync((int)_portInput.Value);
            AppendLog(msg);
            MessageBox.Show(this, msg, "Windows Firewall", MessageBoxButtons.OK, ok ? MessageBoxIcon.Information : MessageBoxIcon.Warning);
        };
        portPanel.Controls.Add(new Label { Text = "Port:", AutoSize = true, Padding = new Padding(0, 6, 4, 0) });
        portPanel.Controls.Add(_portInput);
        portPanel.Controls.Add(_firewallBtn);
        AddDepRow(depTable, "6. Port & Firewall LAN", _depPortLbl, portPanel);

        depBox.Controls.Add(depTable);
        root.Controls.Add(depBox, 0, 1);

        // 3. Kontrol Server
        var ctrlPanel = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, Padding = new Padding(0, 4, 0, 4) };
        _startBtn.Click += async (_, _) => await StartServerAsync();
        _stopBtn.Click += async (_, _) => await StopServerWithGuardAsync();
        _openDashBtn.Click += (_, _) => OpenUrl($"http://localhost:{(int)_portInput.Value}/");
        _copyStudentUrlBtn.Click += (_, _) => CopyStudentUrl();
        _refreshBtn.Click += async (_, _) => await RefreshPreflightAsync();
        _autoOpenCheck.Checked = _settings.AutoOpenBrowser;
        _autoOpenCheck.CheckedChanged += (_, _) => { _settings.AutoOpenBrowser = _autoOpenCheck.Checked; SaveSettings(); };

        ctrlPanel.Controls.Add(_startBtn);
        ctrlPanel.Controls.Add(_stopBtn);
        ctrlPanel.Controls.Add(_openDashBtn);
        ctrlPanel.Controls.Add(_copyStudentUrlBtn);
        ctrlPanel.Controls.Add(_refreshBtn);
        ctrlPanel.Controls.Add(_autoOpenCheck);
        root.Controls.Add(ctrlPanel, 0, 2);

        // 4. Info URL LAN
        var urlBox = new GroupBox { Text = "Alamat Akses Server (Lokal & Jaringan Sekolah)", Dock = DockStyle.Fill, Padding = new Padding(12, 20, 12, 10) };
        _urlInfoLabel.Dock = DockStyle.Fill;
        urlBox.Controls.Add(_urlInfoLabel);
        root.Controls.Add(urlBox, 0, 3);

        // 5. Log Server
        var logBox = new GroupBox { Text = "Log Aktivitas Server", Dock = DockStyle.Fill, Padding = new Padding(10) };
        var logToolbar = new FlowLayoutPanel { Dock = DockStyle.Bottom, FlowDirection = FlowDirection.RightToLeft, AutoSize = true };
        var openDataBtn = new Button { Text = "Buka Folder Data", AutoSize = true };
        openDataBtn.Click += (_, _) => { Directory.CreateDirectory(AppPaths.DataDir); Process.Start(new ProcessStartInfo("explorer.exe", AppPaths.DataDir) { UseShellExecute = true }); };
        var openLogsBtn = new Button { Text = "Buka Folder Log", AutoSize = true };
        openLogsBtn.Click += (_, _) => { Directory.CreateDirectory(AppPaths.LogsDir); Process.Start(new ProcessStartInfo("explorer.exe", AppPaths.LogsDir) { UseShellExecute = true }); };
        var clearLogBtn = new Button { Text = "Bersihkan Tampilan Log", AutoSize = true };
        clearLogBtn.Click += (_, _) => _logBox.Clear();
        logToolbar.Controls.Add(openDataBtn);
        logToolbar.Controls.Add(openLogsBtn);
        logToolbar.Controls.Add(clearLogBtn);

        logBox.Controls.Add(_logBox);
        logBox.Controls.Add(logToolbar);
        root.Controls.Add(logBox, 0, 4);

        Controls.Add(root);
    }

    private static void AddDepRow(TableLayoutPanel table, string title, Label statusLabel, Control actionControl)
    {
        var row = table.RowCount++;
        table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        table.Controls.Add(new Label { Text = title, AutoSize = true, Font = new Font(Control.DefaultFont, FontStyle.Bold), Padding = new Padding(0, 6, 8, 6) }, 0, row);
        statusLabel.Padding = new Padding(0, 6, 8, 6);
        table.Controls.Add(statusLabel, 1, row);
        table.Controls.Add(actionControl, 2, row);
    }

    private void ConfigureTray()
    {
        _trayIcon.Icon = Icon;
        _trayIcon.Text = $"NusaCBT Server ({VersionUtils.CurrentTag})";
        _trayIcon.Visible = true;
        _trayIcon.DoubleClick += (_, _) => RestoreFromTray();

        var menu = new ContextMenuStrip();
        menu.Items.Add("Tampilkan Jendela", null, (_, _) => RestoreFromTray());
        menu.Items.Add("Buka Dashboard Admin", null, (_, _) => OpenUrl($"http://localhost:{(int)_portInput.Value}/"));
        menu.Items.Add(new ToolStripSeparator());
        menu.Items.Add("Hentikan Server & Keluar", null, async (_, _) => await ExitCompletelyAsync());
        _trayIcon.ContextMenuStrip = menu;
    }

    private void RestoreFromTray()
    {
        Show();
        WindowState = FormWindowState.Normal;
        Activate();
    }

    private async Task RefreshPreflightAsync()
    {
        _refreshBtn.Enabled = false;
        try
        {
            var hasNode = File.Exists(AppPaths.NodeExe);
            var hasEntry = File.Exists(AppPaths.ServerEntry);
            if (hasNode && hasEntry)
            {
                _depRuntimeLbl.ForeColor = Color.DarkGreen;
                _depRuntimeLbl.Text = $"[SIAP] Node portable & server-entry tersedia ({VersionUtils.CurrentTag})";
            }
            else
            {
                _depRuntimeLbl.ForeColor = Color.DarkRed;
                _depRuntimeLbl.Text = "[BELUM LENGKAP] runtime\\node.exe atau app\\server-entry.mjs tidak ditemukan.";
            }

            _pgServices = WindowsSystemHelper.FindPostgresServices();
            if (_pgServices.Count == 0)
            {
                _depPostgresLbl.ForeColor = Color.DarkOrange;
                _depPostgresLbl.Text = "[TIDAK TERDETEKSI] Service lokal PostgreSQL tidak ditemukan (lewati jika DB di komputer lain).";
                _startPgBtn.Enabled = false;
                _downloadPgBtn.Visible = true;
            }
            else
            {
                _downloadPgBtn.Visible = false;
                var running = _pgServices.FirstOrDefault(s => s.IsRunning);
                if (running is not null)
                {
                    _depPostgresLbl.ForeColor = Color.DarkGreen;
                    _depPostgresLbl.Text = $"[BERJALAN] {running.DisplayName} ({running.ServiceName})";
                    _startPgBtn.Enabled = false;
                }
                else
                {
                    var first = _pgServices[0];
                    _depPostgresLbl.ForeColor = Color.DarkRed;
                    _depPostgresLbl.Text = $"[BERHENTI] {first.DisplayName} ({first.State})";
                    _startPgBtn.Enabled = true;
                }
            }

            _lastStatus = await PreflightRunner.CheckAsync();
            var st = _lastStatus;

            if (!st.Ok)
            {
                _depDbLbl.ForeColor = Color.DarkRed;
                _depDbLbl.Text = st.Error ?? "Gagal menjalankan preflight.";
                _depConfigLbl.ForeColor = Color.DarkRed;
                _depConfigLbl.Text = "Belum diperiksa.";
                _depSchemaLbl.ForeColor = Color.DarkRed;
                _depSchemaLbl.Text = "Belum diperiksa.";
                UpdateStartAvailability();
                UpdateNetworkUrlInfo();
                return;
            }

            var envAndKeysReady = st.EnvExists && st.Keys.ParticipantOk && st.Keys.TokenOk && st.Keys.KeysDistinct;
            if (envAndKeysReady)
            {
                _depConfigLbl.ForeColor = Color.DarkGreen;
                _depConfigLbl.Text = $"[SIAP] .env.local & 2 kunci enkripsi aktif di {st.DataDir}";
            }
            else
            {
                _depConfigLbl.ForeColor = Color.DarkRed;
                _depConfigLbl.Text = !st.EnvExists
                    ? "[PERLU SETUP] Klik 'Setup Awal / DB' untuk membuat .env.local, kunci, dan admin awal."
                    : $"[MASALAH KUNCI] participant={st.Keys.ParticipantReason}, token={st.Keys.TokenReason}.";
            }

            if (st.Db.Connected && st.Db.IsUtf8)
            {
                _depDbLbl.ForeColor = Color.DarkGreen;
                _depDbLbl.Text = $"[TERHUBUNG] {st.Db.Database}@{st.Db.Host}:{st.Db.Port} (Encoding {st.Db.Encoding})";
            }
            else
            {
                _depDbLbl.ForeColor = Color.DarkRed;
                _depDbLbl.Text = $"[BELUM SIAP] {st.Db.Error}";
            }

            if (st.Db.Connected && st.Db.IsUtf8 && st.Db.PendingMigrations == 0 && st.Db.AdminCount > 0)
            {
                _depSchemaLbl.ForeColor = Color.DarkGreen;
                _depSchemaLbl.Text = $"[SIAP] {st.Db.AppliedMigrations}/{st.Db.TotalMigrations} migrasi diterapkan · {st.Db.AdminCount} akun admin";
                _migrateBtn.Enabled = false;
            }
            else if (st.Db.Connected && st.Db.IsUtf8 && st.Db.PendingMigrations > 0)
            {
                _depSchemaLbl.ForeColor = Color.DarkOrange;
                _depSchemaLbl.Text = $"[MIGRASI TERTUNDA] {st.Db.PendingMigrations} file migrasi belum dijalankan.";
                _migrateBtn.Enabled = true;
            }
            else if (st.Db.Connected && st.Db.AdminCount == 0)
            {
                _depSchemaLbl.ForeColor = Color.DarkRed;
                _depSchemaLbl.Text = "[BELUM ADA ADMIN] Klik 'Setup Awal / DB' untuk membuat akun Superadmin pertama.";
                _migrateBtn.Enabled = false;
            }
            else
            {
                _depSchemaLbl.ForeColor = Color.DimGray;
                _depSchemaLbl.Text = "Menunggu koneksi database UTF-8.";
                _migrateBtn.Enabled = false;
            }

            var port = (int)_portInput.Value;
            var portFree = _runState != ServerRunState.Stopped || WindowsSystemHelper.IsTcpPortAvailable(port);
            _depPortLbl.ForeColor = portFree ? Color.DarkGreen : Color.DarkRed;
            _depPortLbl.Text = _runState != ServerRunState.Stopped
                ? $"[DIGUNAKAN NUSACBT] Mendengarkan port {port}"
                : portFree
                    ? $"[TERSEDIA] Port {port} siap digunakan (pastikan firewall LAN diizinkan)."
                    : $"[BENTROK] Port {port} sedang dipakai aplikasi lain! Ganti nomor port.";

            UpdateStartAvailability();
            UpdateNetworkUrlInfo();
        }
        finally
        {
            _refreshBtn.Enabled = true;
        }
    }

    private void UpdateStartAvailability()
    {
        var ready = _runState == ServerRunState.Stopped
            && File.Exists(AppPaths.NodeExe)
            && File.Exists(AppPaths.ServerEntry)
            && _lastStatus is not null
            && _lastStatus.Ok
            && _lastStatus.EnvExists
            && _lastStatus.Keys.ParticipantOk
            && _lastStatus.Keys.TokenOk
            && _lastStatus.Keys.KeysDistinct
            && _lastStatus.Db.Connected
            && _lastStatus.Db.IsUtf8
            && _lastStatus.Db.AdminCount > 0;
        _startBtn.Enabled = ready;
    }

    private void UpdateNetworkUrlInfo()
    {
        var port = (int)_portInput.Value;
        var lanIps = WindowsSystemHelper.GetLanIPv4Addresses();
        var sb = new StringBuilder();
        sb.Append($"Dashboard Admin (PC ini): http://localhost:{port}/   |   Data: {AppPaths.DataDir}");
        if (lanIps.Count > 0)
        {
            sb.AppendLine();
            sb.Append("Akses Peserta LAN: ");
            sb.Append(string.Join("   |   ", lanIps.Select(ip => $"http://{ip}:{port}/peserta/login")));
        }
        else
        {
            sb.AppendLine();
            sb.Append("Akses Peserta LAN: Belum terdeteksi adaptor jaringan LAN/Wi-Fi aktif.");
        }
        _urlInfoLabel.Text = sb.ToString();
    }

    private async Task StartPostgresClickedAsync()
    {
        var stopped = _pgServices.FirstOrDefault(s => !s.IsRunning);
        if (stopped is null) return;
        _startPgBtn.Enabled = false;
        AppendLog($"Menyalakan service PostgreSQL ({stopped.ServiceName})...");
        var (ok, msg) = await WindowsSystemHelper.StartPostgresServiceAsync(stopped.ServiceName);
        AppendLog(msg);
        if (!ok) MessageBox.Show(this, msg, "Service PostgreSQL", MessageBoxButtons.OK, MessageBoxIcon.Warning);
        await RefreshPreflightAsync();
    }

    private async Task OpenSetupWizardAsync()
    {
        var st = _lastStatus ?? await PreflightRunner.CheckAsync();
        using var dlg = new SetupWizardForm(st);
        if (dlg.ShowDialog(this) == DialogResult.OK)
        {
            AppendLog("Konfigurasi .env.local, kunci enkripsi, migrasi, dan admin awal selesai disiapkan.");
            await RefreshPreflightAsync();
        }
    }

    private async Task RunMigrateClickedAsync()
    {
        _migrateBtn.Enabled = false;
        AppendLog("Menjalankan migrasi database...");
        var res = await PreflightRunner.MigrateAsync();
        if (res.Ok)
        {
            AppendLog($"Migrasi selesai ({res.Applied?.Count ?? 0} baru diterapkan, {res.Skipped?.Count ?? 0} dilewati).");
        }
        else
        {
            AppendLog($"Migrasi gagal: {res.Error}");
            MessageBox.Show(this, res.Error ?? "Migrasi gagal.", "Migrasi Database", MessageBoxButtons.OK, MessageBoxIcon.Error);
        }
        await RefreshPreflightAsync();
    }

    private async Task StartServerAsync()
    {
        await RefreshPreflightAsync();
        if (_lastStatus is null || !_lastStatus.Db.Connected) return;

        if (_lastStatus.Db.PendingMigrations > 0)
        {
            AppendLog($"Menerapkan {_lastStatus.Db.PendingMigrations} migrasi tertunda sebelum server dimulai...");
            var mig = await PreflightRunner.MigrateAsync();
            if (!mig.Ok)
            {
                AppendLog($"Gagal migrasi otomatis: {mig.Error}");
                MessageBox.Show(this, mig.Error ?? "Migrasi gagal.", "Gagal Memulai Server", MessageBoxButtons.OK, MessageBoxIcon.Error);
                return;
            }
        }

        var port = (int)_portInput.Value;
        if (!WindowsSystemHelper.IsTcpPortAvailable(port))
        {
            MessageBox.Show(this, $"Port {port} sedang dipakai aplikasi lain. Silakan ubah nomor port.", "Port Bentrok", MessageBoxButtons.OK, MessageBoxIcon.Warning);
            return;
        }

        Directory.CreateDirectory(AppPaths.LogsDir);
        var logFile = Path.Combine(AppPaths.LogsDir, $"server-{DateTime.Now:yyyyMMdd}.log");
        _logWriter = new StreamWriter(new FileStream(logFile, FileMode.Append, FileAccess.Write, FileShare.ReadWrite), Encoding.UTF8) { AutoFlush = true };

        UpdateRunStateUi(ServerRunState.Starting);
        AppendLog($"Memulai NusaCBT Server {VersionUtils.CurrentTag} di port {port}...");

        var psi = new ProcessStartInfo(AppPaths.NodeExe)
        {
            WorkingDirectory = AppPaths.AppDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        psi.ArgumentList.Add(AppPaths.ServerEntry);
        psi.Environment["PORT"] = port.ToString();
        psi.Environment["HOSTNAME"] = "0.0.0.0";
        psi.Environment["NUSACBT_DATA_DIR"] = AppPaths.DataDir;

        _serverProcess = new Process { StartInfo = psi, EnableRaisingEvents = true };
        _serverProcess.OutputDataReceived += (_, e) => { if (e.Data is not null) AppendLog(e.Data); };
        _serverProcess.ErrorDataReceived += (_, e) => { if (e.Data is not null) AppendLog($"[ERR] {e.Data}"); };
        _serverProcess.Exited += (_, _) => BeginInvoke(OnServerProcessExited);

        _serverProcess.Start();
        _job.AddProcess(_serverProcess);
        _serverProcess.BeginOutputReadLine();
        _serverProcess.BeginErrorReadLine();

        var healthy = await WaitForServerHealthAsync(port, TimeSpan.FromSeconds(30));
        if (_serverProcess is null || _serverProcess.HasExited) return;

        if (healthy)
        {
            UpdateRunStateUi(ServerRunState.Running);
            AppendLog($"Server siap! Dashboard: http://localhost:{port}/");
            if (_autoOpenCheck.Checked)
            {
                OpenUrl($"http://localhost:{port}/");
            }
        }
        else
        {
            UpdateRunStateUi(ServerRunState.Running);
            AppendLog("Server berjalan, namun health check belum merespons dalam 30 detik. Periksa log di atas.");
        }
    }

    private async Task<bool> WaitForServerHealthAsync(int port, TimeSpan timeout)
    {
        using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(2) };
        var deadline = DateTime.UtcNow + timeout;
        while (DateTime.UtcNow < deadline && _serverProcess is { HasExited: false })
        {
            try
            {
                using var resp = await http.GetAsync($"http://127.0.0.1:{port}/api/health");
                if (resp.IsSuccessStatusCode) return true;
            }
            catch
            {
                // Server masih booting.
            }
            await Task.Delay(500);
        }
        return false;
    }

    private async Task StopServerWithGuardAsync()
    {
        if (_serverProcess is null || _serverProcess.HasExited)
        {
            UpdateRunStateUi(ServerRunState.Stopped);
            return;
        }

        var active = await PreflightRunner.GetActiveExamsCountAsync();
        if (active > 0)
        {
            var confirm = MessageBox.Show(
                this,
                $"Terdeteksi {active} peserta sedang mengerjakan ujian! Menghentikan server akan memutus koneksi peserta.\n\nTetap hentikan server?",
                "Konfirmasi Hentikan Server",
                MessageBoxButtons.YesNo,
                MessageBoxIcon.Warning,
                MessageBoxDefaultButton.Button2);
            if (confirm != DialogResult.Yes) return;
        }

        await StopServerCoreAsync();
    }

    private async Task StopServerCoreAsync()
    {
        if (_serverProcess is null) return;
        try
        {
            if (!_serverProcess.HasExited)
            {
                AppendLog("Menghentikan server NusaCBT...");
                _serverProcess.Kill(entireProcessTree: true);
                await _serverProcess.WaitForExitAsync();
            }
        }
        catch (Exception ex)
        {
            AppendLog($"Catatan saat menghentikan proses: {ex.Message}");
        }
        finally
        {
            CleanupServerProcessResources();
            UpdateRunStateUi(ServerRunState.Stopped);
            await RefreshPreflightAsync();
        }
    }

    private void OnServerProcessExited()
    {
        var code = _serverProcess?.ExitCode;
        AppendLog($"Proses server berhenti (exit code: {code}).");
        CleanupServerProcessResources();
        UpdateRunStateUi(ServerRunState.Stopped);
        _ = RefreshPreflightAsync();
    }

    private void CleanupServerProcessResources()
    {
        _serverProcess?.Dispose();
        _serverProcess = null;
        _logWriter?.Dispose();
        _logWriter = null;
    }

    private void UpdateRunStateUi(ServerRunState state)
    {
        _runState = state;
        _portInput.Enabled = state == ServerRunState.Stopped;
        _setupBtn.Enabled = state == ServerRunState.Stopped;
        _stopBtn.Enabled = state != ServerRunState.Stopped;
        _openDashBtn.Enabled = state == ServerRunState.Running;
        _copyStudentUrlBtn.Enabled = state != ServerRunState.Stopped;

        switch (state)
        {
            case ServerRunState.Stopped:
                _stateBadge.Text = "BERHENTI";
                _stateBadge.BackColor = Color.FromArgb(100, 116, 139);
                break;
            case ServerRunState.Starting:
                _stateBadge.Text = "MEMULAI...";
                _stateBadge.BackColor = Color.FromArgb(217, 119, 6);
                _startBtn.Enabled = false;
                break;
            case ServerRunState.Running:
                _stateBadge.Text = "BERJALAN";
                _stateBadge.BackColor = Color.FromArgb(22, 163, 74);
                _startBtn.Enabled = false;
                break;
        }
    }

    private void CopyStudentUrl()
    {
        var port = (int)_portInput.Value;
        var ip = WindowsSystemHelper.GetLanIPv4Addresses().FirstOrDefault() ?? "localhost";
        var url = $"http://{ip}:{port}/peserta/login";
        Clipboard.SetText(url);
        AppendLog($"Link ujian peserta disalin: {url}");
        MessageBox.Show(this, $"Link login peserta disalin ke clipboard:\n{url}", "Link Disalin", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private void OpenUpdateDialog(bool checkOnlineImmediately)
    {
        using var dlg = new UpdateDialog(checkOnlineImmediately, StopServerCoreAsync);
        dlg.ShowDialog(this);
    }

    private static void OpenUrl(string url) => Process.Start(new ProcessStartInfo(url) { UseShellExecute = true });

    private void AppendLog(string line)
    {
        if (InvokeRequired)
        {
            BeginInvoke(() => AppendLog(line));
            return;
        }
        var formatted = $"[{DateTime.Now:HH:mm:ss}] {line}";
        _logBox.AppendText(formatted + Environment.NewLine);
        try { _logWriter?.WriteLine(formatted); } catch { }
    }

    private async void OnMainFormClosing(object? sender, FormClosingEventArgs e)
    {
        if (!_forceExit && e.CloseReason == CloseReason.UserClosing && _runState != ServerRunState.Stopped)
        {
            var choice = MessageBox.Show(
                this,
                "Server NusaCBT masih berjalan. Sembunyikan ke System Tray agar server tetap aktif?\n\nPilih 'Yes' untuk sembunyikan ke tray, 'No' untuk menghentikan server dan keluar.",
                "NusaCBT Server Masih Berjalan",
                MessageBoxButtons.YesNoCancel,
                MessageBoxIcon.Question);

            if (choice == DialogResult.Cancel)
            {
                e.Cancel = true;
                return;
            }
            if (choice == DialogResult.Yes)
            {
                e.Cancel = true;
                Hide();
                _trayIcon.ShowBalloonTip(2500, "NusaCBT Server", "Server tetap berjalan di latar belakang.", ToolTipIcon.Info);
                return;
            }

            e.Cancel = true;
            await ExitCompletelyAsync();
        }
    }

    private async Task ExitCompletelyAsync()
    {
        _forceExit = true;
        await StopServerCoreAsync();
        Application.Exit();
    }

    private void LoadSettings()
    {
        try
        {
            if (File.Exists(AppPaths.SettingsFile))
            {
                var loaded = JsonSerializer.Deserialize<LauncherSettings>(File.ReadAllText(AppPaths.SettingsFile));
                if (loaded is not null)
                {
                    if (loaded.Port is >= 80 and <= 65535) _settings.Port = loaded.Port;
                    _settings.AutoOpenBrowser = loaded.AutoOpenBrowser;
                }
            }
        }
        catch
        {
            _settings = new LauncherSettings();
        }
    }

    private void SaveSettings()
    {
        try
        {
            Directory.CreateDirectory(AppPaths.DataDir);
            File.WriteAllText(AppPaths.SettingsFile, JsonSerializer.Serialize(_settings, new JsonSerializerOptions { WriteIndented = true }));
        }
        catch
        {
            // Non-fatal jika gagal menyimpan preferensi port.
        }
    }
}
