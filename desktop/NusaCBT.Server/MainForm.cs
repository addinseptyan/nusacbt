using System.Diagnostics;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
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

    private sealed class CrispQrPictureBox : PictureBox
    {
        protected override void OnPaint(PaintEventArgs pe)
        {
            pe.Graphics.InterpolationMode = InterpolationMode.NearestNeighbor;
            pe.Graphics.PixelOffsetMode = PixelOffsetMode.Half;
            base.OnPaint(pe);
        }
    }

    private readonly JobObject _job = new();
    private readonly NotifyIcon _trayIcon = new();
    private readonly ToolTip _toolTip = new();
    private readonly Label _versionBadge = new() { AutoSize = true, BackColor = Color.FromArgb(226, 232, 240), Padding = new Padding(8, 3, 8, 3), Margin = new Padding(8, 5, 4, 3) };
    private readonly Label _stateBadge = new() { AutoSize = true, Padding = new Padding(10, 3, 10, 3), ForeColor = Color.White, Margin = new Padding(4, 5, 4, 3) };

    private readonly Label _depRuntimeLbl = new() { AutoSize = true, MaximumSize = new Size(520, 0), Text = "Memeriksa runtime..." };
    private readonly Label _depPostgresLbl = new() { AutoSize = true, MaximumSize = new Size(520, 0), Text = "Memeriksa service PostgreSQL..." };
    private readonly Label _depDbLbl = new() { AutoSize = true, MaximumSize = new Size(520, 0), Text = "Menunggu pemeriksaan..." };
    private readonly Label _depConfigLbl = new() { AutoSize = true, MaximumSize = new Size(520, 0), Text = "Menunggu pemeriksaan..." };
    private readonly Label _depSchemaLbl = new() { AutoSize = true, MaximumSize = new Size(520, 0), Text = "Menunggu pemeriksaan..." };
    private readonly Label _depPortLbl = new() { AutoSize = true, MaximumSize = new Size(520, 0), Text = "Memeriksa port..." };

    private readonly Button _startPgBtn = new() { Text = "Nyalakan PostgreSQL", AutoSize = true, Enabled = false };
    private readonly Button _downloadPgBtn = new() { Text = "Unduh PostgreSQL", AutoSize = true, Visible = false };
    private readonly Button _setupBtn = new() { Text = "Setup Awal / DB", AutoSize = true };
    private readonly Button _migrateBtn = new() { Text = "Jalankan Migrasi", AutoSize = true, Enabled = false };
    private readonly NumericUpDown _portInput = new() { Minimum = 80, Maximum = 65535, Value = 3000, Width = 78 };
    private readonly Button _firewallBtn = new() { Text = "Izinkan Port Firewall", AutoSize = true };

    private readonly Panel _guidancePanel = new() { Dock = DockStyle.Fill, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, BackColor = Color.FromArgb(239, 246, 255), Padding = new Padding(10, 6, 10, 6), Margin = new Padding(0, 4, 0, 3) };
    private readonly Label _guidanceLabel = new() { AutoSize = true, MaximumSize = new Size(980, 0), ForeColor = Color.FromArgb(30, 58, 138), Font = new Font(Control.DefaultFont, FontStyle.Bold), Text = "Memeriksa kesiapan dependensi server..." };

    private readonly Button _startBtn = new() { Text = "Mulai Server", AutoSize = true, Padding = new Padding(12, 6, 12, 6) };
    private readonly Button _stopBtn = new() { Text = "Hentikan Server", AutoSize = true, Enabled = false, Padding = new Padding(12, 6, 12, 6) };
    private readonly Button _openDashBtn = new() { Text = "Buka Dashboard Admin", AutoSize = true, Enabled = false, Padding = new Padding(10, 6, 10, 6) };
    private readonly Button _copyStudentUrlBtn = new() { Text = "Salin Link Peserta", AutoSize = true, Padding = new Padding(10, 6, 10, 6) };
    private readonly Button _refreshBtn = new() { Text = "Refresh Status", AutoSize = true, Padding = new Padding(10, 6, 10, 6) };
    private readonly Button _checkUpdateBtn = new() { Text = "Cek Update", AutoSize = true, Padding = new Padding(10, 5, 10, 5) };
    private readonly Button _offlineZipBtn = new() { Text = "Update dari ZIP", AutoSize = true, Padding = new Padding(10, 5, 10, 5) };
    private readonly CheckBox _autoOpenCheck = new() { Text = "Buka browser otomatis saat server siap", Checked = true, AutoSize = true, Margin = new Padding(8, 7, 4, 4) };

    private readonly Label _urlInfoLabel = new() { AutoSize = true, MaximumSize = new Size(800, 0), ForeColor = Color.FromArgb(51, 65, 85) };
    private readonly ComboBox _lanIpCombo = new() { DropDownStyle = ComboBoxStyle.DropDownList, Width = 175, Margin = new Padding(4, 2, 8, 2) };
    private readonly Label _studentUrlLabel = new() { AutoSize = true, Font = new Font(Control.DefaultFont, FontStyle.Bold), ForeColor = Color.FromArgb(30, 64, 175), Margin = new Padding(0, 5, 0, 2) };
    private readonly Label _qrCaptionLabel = new() { AutoSize = true, MaximumSize = new Size(800, 0), ForeColor = Color.FromArgb(71, 85, 105), Margin = new Padding(0, 3, 0, 4) };
    private readonly Button _zoomQrBtn = new() { Text = "Perbesar QR", AutoSize = true, Padding = new Padding(8, 3, 8, 3) };
    private readonly Button _saveQrBtn = new() { Text = "Simpan QR (.png)", AutoSize = true, Padding = new Padding(8, 3, 8, 3) };
    private readonly CrispQrPictureBox _qrPictureBox = new()
    {
        Size = new Size(116, 116),
        SizeMode = PictureBoxSizeMode.Zoom,
        BackColor = Color.White,
        BorderStyle = BorderStyle.FixedSingle,
        Cursor = Cursors.Hand,
        Margin = new Padding(10, 0, 0, 0),
    };

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
    private bool _updatingIpCombo;
    private string _currentStudentUrl = "http://localhost:3000/peserta/login";

    public MainForm()
    {
        LoadSettings();

        Text = $"NusaCBT Server Launcher ({VersionUtils.CurrentTag})";
        StartPosition = FormStartPosition.CenterScreen;
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(1060, 660);
        MinimumSize = new Size(880, 560);
        Icon = Icon.ExtractAssociatedIcon(Application.ExecutablePath);

        BuildUi();
        ConfigureTray();
        UpdateRunStateUi(ServerRunState.Stopped);
        UpdateNetworkUrlInfo();

        Load += (_, _) => ClampToWorkingArea();
        Shown += async (_, _) => await RefreshPreflightAsync();
        FormClosing += OnMainFormClosing;
        FormClosed += (_, _) =>
        {
            _trayIcon.Visible = false;
            _trayIcon.Dispose();
            _toolTip.Dispose();
            _qrPictureBox.Image?.Dispose();
            _job.Dispose();
        };
    }

    private void ClampToWorkingArea()
    {
        var area = Screen.FromControl(this).WorkingArea;
        var targetW = Math.Min(Width, Math.Max(640, area.Width - 16));
        var targetH = Math.Min(Height, Math.Max(480, area.Height - 16));
        if (MinimumSize.Width > targetW || MinimumSize.Height > targetH)
        {
            MinimumSize = new Size(Math.Min(MinimumSize.Width, targetW), Math.Min(MinimumSize.Height, targetH));
        }
        Size = new Size(targetW, targetH);
        Location = new Point(
            area.Left + Math.Max(0, (area.Width - Width) / 2),
            area.Top + Math.Max(0, (area.Height - Height) / 2));
    }

    private void BuildUi()
    {
        var root = new TableLayoutPanel { Dock = DockStyle.Fill, Padding = new Padding(12, 10, 12, 10), ColumnCount = 1, RowCount = 6, AutoScroll = true };
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        root.RowStyles.Add(new RowStyle(SizeType.Percent, 100));

        // 1. Header (FlowLayout DPI-safe tanpa koordinat piksel statis)
        var header = new TableLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, ColumnCount = 2, Margin = new Padding(0, 0, 0, 4) };
        header.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        header.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        var headerLeft = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = false };
        var titleLbl = new Label { Text = "NusaCBT Server PC", Font = new Font(Font.FontFamily, 13.5F, FontStyle.Bold), AutoSize = true, Margin = new Padding(0, 2, 4, 2) };
        _versionBadge.Text = VersionUtils.CurrentTag;
        headerLeft.Controls.Add(titleLbl);
        headerLeft.Controls.Add(_versionBadge);
        headerLeft.Controls.Add(_stateBadge);

        var headerRight = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, FlowDirection = FlowDirection.RightToLeft, WrapContents = false };
        _offlineZipBtn.Click += (_, _) => OpenUpdateDialog(checkOnlineImmediately: false);
        _checkUpdateBtn.Click += (_, _) => OpenUpdateDialog(checkOnlineImmediately: true);
        headerRight.Controls.Add(_offlineZipBtn);
        headerRight.Controls.Add(_checkUpdateBtn);

        header.Controls.Add(headerLeft, 0, 0);
        header.Controls.Add(headerRight, 1, 0);
        root.Controls.Add(header, 0, 0);

        // 2. Checklist Dependensi (AutoSize=true & WrapContents=false pada aksi agar Izinkan Port Firewall selalu tampil penuh)
        var depBox = new GroupBox
        {
            Text = "Pemeriksaan Dependensi & Kesiapan Server",
            Dock = DockStyle.Fill,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Padding = new Padding(10, 6, 10, 8),
        };
        var depTable = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            ColumnCount = 3,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
        };
        depTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));
        depTable.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        depTable.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        AddDepRow(depTable, "1. Runtime Node & App", _depRuntimeLbl, new Label { AutoSize = true });

        var pgActionPanel = new FlowLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = false, Margin = Padding.Empty };
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

        var portPanel = new FlowLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = false, Margin = Padding.Empty };
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
        portPanel.Controls.Add(new Label { Text = "Port:", AutoSize = true, Padding = new Padding(0, 5, 4, 0) });
        portPanel.Controls.Add(_portInput);
        portPanel.Controls.Add(_firewallBtn);
        AddDepRow(depTable, "6. Port & Firewall LAN", _depPortLbl, portPanel);

        depBox.Controls.Add(depTable);
        root.Controls.Add(depBox, 0, 1);

        // 3. Banner Panduan Aksi Berikutnya
        _guidanceLabel.Dock = DockStyle.Top;
        _guidancePanel.Controls.Add(_guidanceLabel);
        root.Controls.Add(_guidancePanel, 0, 2);

        // 4. Kontrol Server
        var ctrlPanel = new FlowLayoutPanel { Dock = DockStyle.Fill, AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, Padding = new Padding(0, 2, 0, 2) };
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
        root.Controls.Add(ctrlPanel, 0, 3);

        // 5. Info URL LAN & QR Code Akses Peserta
        var urlBox = new GroupBox
        {
            Text = "Alamat Akses Server & QR Code Link Peserta",
            Dock = DockStyle.Fill,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Padding = new Padding(10, 6, 10, 8),
        };
        var urlGrid = new TableLayoutPanel
        {
            Dock = DockStyle.Top,
            ColumnCount = 2,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
        };
        urlGrid.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 100));
        urlGrid.ColumnStyles.Add(new ColumnStyle(SizeType.AutoSize));

        var urlLeft = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            ColumnCount = 1,
            AutoSize = true,
            AutoSizeMode = AutoSizeMode.GrowAndShrink,
            Margin = Padding.Empty,
        };
        urlLeft.Controls.Add(_urlInfoLabel, 0, 0);

        var studentRow = new FlowLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = false, Margin = new Padding(0, 4, 0, 0) };
        _lanIpCombo.SelectedIndexChanged += (_, _) =>
        {
            if (!_updatingIpCombo) UpdateStudentUrlAndQr();
        };
        studentRow.Controls.Add(new Label { Text = "IP LAN / Wi-Fi:", AutoSize = true, Padding = new Padding(0, 5, 4, 0) });
        studentRow.Controls.Add(_lanIpCombo);
        studentRow.Controls.Add(_studentUrlLabel);
        urlLeft.Controls.Add(studentRow, 0, 1);

        urlLeft.Controls.Add(_qrCaptionLabel, 0, 2);

        var qrActions = new FlowLayoutPanel { AutoSize = true, AutoSizeMode = AutoSizeMode.GrowAndShrink, WrapContents = false, Margin = Padding.Empty };
        _zoomQrBtn.Click += (_, _) => ShowLargeQrDialog();
        _saveQrBtn.Click += (_, _) => SaveQrPng();
        qrActions.Controls.Add(_zoomQrBtn);
        qrActions.Controls.Add(_saveQrBtn);
        urlLeft.Controls.Add(qrActions, 0, 3);

        _qrPictureBox.Click += (_, _) => ShowLargeQrDialog();
        _toolTip.SetToolTip(_qrPictureBox, "Klik untuk memperbesar QR Code link login peserta");

        urlGrid.Controls.Add(urlLeft, 0, 0);
        urlGrid.Controls.Add(_qrPictureBox, 1, 0);
        urlBox.Controls.Add(urlGrid);
        root.Controls.Add(urlBox, 0, 4);

        // 6. Log Server
        var logBox = new GroupBox
        {
            Text = "Log Aktivitas Server",
            Dock = DockStyle.Fill,
            MinimumSize = new Size(0, 115),
            Padding = new Padding(8, 6, 8, 8),
        };
        var logToolbar = new FlowLayoutPanel { Dock = DockStyle.Bottom, FlowDirection = FlowDirection.RightToLeft, AutoSize = true, WrapContents = false };
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
        root.Controls.Add(logBox, 0, 5);

        Controls.Add(root);
    }

    private static void AddDepRow(TableLayoutPanel table, string title, Label statusLabel, Control actionControl)
    {
        var row = table.RowCount++;
        table.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        table.Controls.Add(new Label { Text = title, AutoSize = true, Font = new Font(Control.DefaultFont, FontStyle.Bold), Padding = new Padding(0, 4, 10, 4) }, 0, row);
        statusLabel.Padding = new Padding(0, 4, 8, 4);
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
                UpdateGuidanceAndStartAvailability(hasNode && hasEntry);
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
                    ? "[PERLU SETUP] Klik 'Setup Awal / DB' di sebelah kanan untuk membuat .env.local, kunci, dan admin awal."
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

            UpdateGuidanceAndStartAvailability(hasNode && hasEntry);
            UpdateNetworkUrlInfo();
        }
        catch (Exception ex)
        {
            AppendLog($"Gagal memeriksa dependensi: {ex.Message}");
            SetGuidance($"Gagal memeriksa dependensi: {ex.Message}", Color.FromArgb(254, 242, 242), Color.DarkRed);
            _startBtn.Enabled = false;
        }
        finally
        {
            _refreshBtn.Enabled = true;
        }
    }

    private void UpdateGuidanceAndStartAvailability(bool runtimeOk)
    {
        var port = (int)_portInput.Value;
        var st = _lastStatus;
        var envAndKeysReady = st is not null && st.Ok && st.EnvExists && st.Keys.ParticipantOk && st.Keys.TokenOk && st.Keys.KeysDistinct;
        var dbReady = st is not null && st.Ok && st.Db.Connected && st.Db.IsUtf8;
        var adminReady = st is not null && st.Ok && st.Db.AdminCount > 0;
        var portFree = _runState != ServerRunState.Stopped || WindowsSystemHelper.IsTcpPortAvailable(port);

        var canStart = _runState == ServerRunState.Stopped && runtimeOk && envAndKeysReady && dbReady && adminReady && portFree;
        _startBtn.Enabled = canStart;

        _setupBtn.BackColor = !envAndKeysReady && _runState == ServerRunState.Stopped ? Color.FromArgb(37, 99, 235) : SystemColors.Control;
        _setupBtn.ForeColor = !envAndKeysReady && _runState == ServerRunState.Stopped ? Color.White : SystemColors.ControlText;

        if (_runState == ServerRunState.Starting)
        {
            SetGuidance("Menyalakan server NusaCBT... mohon tunggu hingga status berubah menjadi BERJALAN.", Color.FromArgb(255, 251, 235), Color.FromArgb(180, 83, 9));
            return;
        }
        if (_runState == ServerRunState.Running)
        {
            SetGuidance($"Server sedang BERJALAN di port {port}. Klik 'Buka Dashboard Admin' untuk membuka aplikasi di browser.", Color.FromArgb(240, 253, 244), Color.FromArgb(22, 101, 52));
            return;
        }

        if (!runtimeOk)
        {
            SetGuidance("Runtime Node atau aplikasi belum lengkap. Pasang ulang installer NusaCBT.", Color.FromArgb(254, 242, 242), Color.DarkRed);
        }
        else if (st is null || !st.Ok)
        {
            SetGuidance($"Preflight belum dapat dijalankan: {st?.Error ?? "Periksa log aktivitas di bawah."}", Color.FromArgb(254, 242, 242), Color.DarkRed);
        }
        else if (!envAndKeysReady)
        {
            SetGuidance("Langkah pertama: klik tombol 'Setup Awal / DB' pada baris 4 untuk mengatur koneksi PostgreSQL, membuat kunci enkripsi di ProgramData, dan akun admin awal.", Color.FromArgb(239, 246, 255), Color.FromArgb(30, 58, 138));
        }
        else if (!dbReady)
        {
            var stoppedPg = _pgServices.Count > 0 && !_pgServices.Any(s => s.IsRunning);
            SetGuidance(
                stoppedPg
                    ? "Service PostgreSQL lokal belum menyala. Klik 'Nyalakan PostgreSQL' pada baris 2, lalu klik 'Refresh Status'."
                    : $"Database belum terhubung ({st.Db.Error}). Klik 'Setup Awal / DB' untuk memperbarui pengaturan database.",
                Color.FromArgb(254, 242, 242),
                Color.DarkRed);
        }
        else if (!adminReady)
        {
            SetGuidance("Belum ada akun admin di database. Klik 'Setup Awal / DB' pada baris 4 untuk membuat akun Superadmin pertama.", Color.FromArgb(254, 242, 242), Color.DarkRed);
        }
        else if (!portFree)
        {
            SetGuidance($"Port {port} sedang digunakan oleh aplikasi lain. Ubah angka port pada baris 6 lalu klik 'Refresh Status'.", Color.FromArgb(254, 242, 242), Color.DarkRed);
        }
        else
        {
            SetGuidance("Semua dependensi siap! Klik 'Mulai Server' untuk menyalakan NusaCBT agar dapat diakses melalui browser.", Color.FromArgb(240, 253, 244), Color.FromArgb(22, 101, 52));
        }
    }

    private void SetGuidance(string text, Color bg, Color fg)
    {
        _guidancePanel.BackColor = bg;
        _guidanceLabel.ForeColor = fg;
        _guidanceLabel.Text = text;
    }

    private void UpdateNetworkUrlInfo()
    {
        var port = (int)_portInput.Value;
        var lanIps = WindowsSystemHelper.GetLanIPv4Addresses();
        _urlInfoLabel.Text = $"Dashboard Admin (PC ini): http://localhost:{port}/   |   Data: {AppPaths.DataDir}";

        var prevSelected = _lanIpCombo.SelectedItem as string;
        List<string> items = lanIps.Count > 0 ? lanIps : ["localhost"];

        _updatingIpCombo = true;
        try
        {
            _lanIpCombo.BeginUpdate();
            _lanIpCombo.Items.Clear();
            foreach (var ip in items) _lanIpCombo.Items.Add(ip);
            var idx = prevSelected is not null ? _lanIpCombo.Items.IndexOf(prevSelected) : -1;
            _lanIpCombo.SelectedIndex = idx >= 0 ? idx : 0;
        }
        finally
        {
            _lanIpCombo.EndUpdate();
            _updatingIpCombo = false;
        }

        UpdateStudentUrlAndQr(hasLanAdapter: lanIps.Count > 0);
    }

    private void UpdateStudentUrlAndQr(bool? hasLanAdapter = null)
    {
        var port = (int)_portInput.Value;
        var selectedHost = _lanIpCombo.SelectedItem as string;
        if (string.IsNullOrWhiteSpace(selectedHost))
        {
            selectedHost = WindowsSystemHelper.GetLanIPv4Addresses().FirstOrDefault() ?? "localhost";
        }

        var hasLan = hasLanAdapter ?? !string.Equals(selectedHost, "localhost", StringComparison.OrdinalIgnoreCase);
        _currentStudentUrl = $"http://{selectedHost}:{port}/peserta/login";
        _studentUrlLabel.Text = _currentStudentUrl;
        _qrCaptionLabel.Text = hasLan
            ? "Scan QR Code di samping dengan kamera HP/tablet peserta untuk langsung membuka halaman login ujian."
            : "Belum terdeteksi adaptor LAN/Wi-Fi aktif (sementara memakai localhost). Hubungkan ke jaringan agar dapat di-scan peserta.";

        try
        {
            var nextBmp = QrCodeGenerator.RenderBitmap(_currentStudentUrl, 240);
            var prevImg = _qrPictureBox.Image;
            _qrPictureBox.Image = nextBmp;
            prevImg?.Dispose();
        }
        catch (Exception ex)
        {
            AppendLog($"Gagal membuat QR Code link peserta: {ex.Message}");
        }
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
        UpdateGuidanceAndStartAvailability(runtimeOk: true);
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

        UpdateRunStateUi(ServerRunState.Running);
        UpdateGuidanceAndStartAvailability(runtimeOk: true);

        if (healthy)
        {
            AppendLog($"Server siap! Dashboard: http://localhost:{port}/");
            if (_autoOpenCheck.Checked)
            {
                OpenUrl($"http://localhost:{port}/");
            }
        }
        else
        {
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
        _copyStudentUrlBtn.Enabled = true;

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
        var url = _currentStudentUrl;
        Clipboard.SetText(url);
        AppendLog($"Link ujian peserta disalin: {url}");
        MessageBox.Show(this, $"Link login peserta disalin ke clipboard:\n{url}", "Link Disalin", MessageBoxButtons.OK, MessageBoxIcon.Information);
    }

    private void ShowLargeQrDialog()
    {
        using var bmp = QrCodeGenerator.RenderBitmap(_currentStudentUrl, 340);
        using var dlg = new Form
        {
            Text = "QR Code Link Peserta — NusaCBT",
            StartPosition = FormStartPosition.CenterParent,
            FormBorderStyle = FormBorderStyle.FixedDialog,
            MaximizeBox = false,
            MinimizeBox = false,
            AutoScaleMode = AutoScaleMode.Dpi,
            ClientSize = new Size(410, 480),
            Icon = Icon,
        };

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(16),
            ColumnCount = 1,
            RowCount = 4,
        };
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.Percent, 100));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        layout.RowStyles.Add(new RowStyle(SizeType.AutoSize));

        var heading = new Label
        {
            Text = "Scan QR Code untuk membuka halaman login peserta",
            AutoSize = true,
            Dock = DockStyle.Top,
            TextAlign = ContentAlignment.MiddleCenter,
            Font = new Font(Font.FontFamily, 10F, FontStyle.Bold),
            Margin = new Padding(0, 0, 0, 8),
        };
        var qrBox = new CrispQrPictureBox
        {
            Image = bmp,
            SizeMode = PictureBoxSizeMode.Zoom,
            Dock = DockStyle.Fill,
            BackColor = Color.White,
            BorderStyle = BorderStyle.FixedSingle,
        };
        var urlText = new TextBox
        {
            Text = _currentStudentUrl,
            ReadOnly = true,
            BorderStyle = BorderStyle.None,
            BackColor = dlg.BackColor,
            TextAlign = HorizontalAlignment.Center,
            Dock = DockStyle.Top,
            Font = new Font(Font.FontFamily, 10F, FontStyle.Bold),
            ForeColor = Color.FromArgb(30, 64, 175),
            Margin = new Padding(0, 10, 0, 10),
        };
        var btnBar = new FlowLayoutPanel
        {
            Dock = DockStyle.Fill,
            FlowDirection = FlowDirection.RightToLeft,
            AutoSize = true,
            WrapContents = false,
        };
        var closeBtn = new Button { Text = "Tutup", AutoSize = true, DialogResult = DialogResult.OK, Padding = new Padding(12, 5, 12, 5) };
        var saveBtn = new Button { Text = "Simpan PNG...", AutoSize = true, Padding = new Padding(10, 5, 10, 5) };
        saveBtn.Click += (_, _) => SaveQrPng();
        var copyBtn = new Button { Text = "Salin Link", AutoSize = true, Padding = new Padding(10, 5, 10, 5) };
        copyBtn.Click += (_, _) => CopyStudentUrl();
        btnBar.Controls.Add(closeBtn);
        btnBar.Controls.Add(saveBtn);
        btnBar.Controls.Add(copyBtn);

        layout.Controls.Add(heading, 0, 0);
        layout.Controls.Add(qrBox, 0, 1);
        layout.Controls.Add(urlText, 0, 2);
        layout.Controls.Add(btnBar, 0, 3);
        dlg.Controls.Add(layout);
        dlg.AcceptButton = closeBtn;
        dlg.ShowDialog(this);
    }

    private void SaveQrPng()
    {
        var port = (int)_portInput.Value;
        using var sfd = new SaveFileDialog
        {
            Title = "Simpan QR Code Link Peserta",
            Filter = "PNG Image (*.png)|*.png",
            FileName = $"qr-peserta-nusacbt-{port}.png",
        };
        if (sfd.ShowDialog(this) != DialogResult.OK) return;

        using var bmp = QrCodeGenerator.RenderBitmap(_currentStudentUrl, 520);
        bmp.Save(sfd.FileName, ImageFormat.Png);
        AppendLog($"QR Code link peserta disimpan ke {sfd.FileName}");
        MessageBox.Show(this, $"QR Code berhasil disimpan:\n{sfd.FileName}", "QR Code Disimpan", MessageBoxButtons.OK, MessageBoxIcon.Information);
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
