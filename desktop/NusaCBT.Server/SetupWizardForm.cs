namespace NusaCBT.Server;

internal sealed class SetupWizardForm : Form
{
    private readonly TextBox _hostBox = new() { Text = "127.0.0.1", Dock = DockStyle.Fill };
    private readonly NumericUpDown _portNum = new() { Minimum = 1, Maximum = 65535, Value = 5432, Dock = DockStyle.Fill };
    private readonly TextBox _dbBox = new() { Text = "nusacbt", Dock = DockStyle.Fill };
    private readonly TextBox _userBox = new() { Text = "nusacbt_app", Dock = DockStyle.Fill };
    private readonly TextBox _passBox = new() { UseSystemPasswordChar = true, Dock = DockStyle.Fill };
    private readonly CheckBox _createDbCheck = new() { Text = "Buat user & database UTF8 otomatis jika belum ada", Checked = true, AutoSize = true };
    private readonly TextBox _pgAdminUserBox = new() { Text = "postgres", Dock = DockStyle.Fill };
    private readonly TextBox _pgAdminPassBox = new() { UseSystemPasswordChar = true, Dock = DockStyle.Fill };
    private readonly CheckBox _cookieSecureCheck = new() { Text = "Aktifkan cookie HTTPS saja (centang hanya jika memakai reverse proxy HTTPS)", Checked = false, AutoSize = true };
    private readonly TextBox _adminUserBox = new() { Text = "adminsekolah", Dock = DockStyle.Fill };
    private readonly TextBox _adminPassBox = new() { UseSystemPasswordChar = true, Dock = DockStyle.Fill };
    private readonly TextBox _adminConfirmBox = new() { UseSystemPasswordChar = true, Dock = DockStyle.Fill };
    private readonly Label _statusLabel = new() { AutoSize = true, ForeColor = Color.DarkRed };
    private readonly Button _saveBtn = new() { Text = "Simpan, Migrasi & Siapkan Kunci", AutoSize = true, Padding = new Padding(12, 6, 12, 6) };
    private readonly Button _cancelBtn = new() { Text = "Batal", AutoSize = true, Padding = new Padding(12, 6, 12, 6) };

    public SetupWizardForm(PreflightStatus current)
    {
        Text = "Pengaturan Awal Server NusaCBT";
        StartPosition = FormStartPosition.CenterParent;
        FormBorderStyle = FormBorderStyle.FixedDialog;
        MaximizeBox = false;
        MinimizeBox = false;
        AutoScaleMode = AutoScaleMode.Dpi;
        ClientSize = new Size(560, 560);

        _hostBox.Text = string.IsNullOrWhiteSpace(current.Db.Host) ? "127.0.0.1" : current.Db.Host;
        if (current.Db.Port >= 1 && current.Db.Port <= 65535) _portNum.Value = current.Db.Port;
        _dbBox.Text = string.IsNullOrWhiteSpace(current.Db.Database) ? "nusacbt" : current.Db.Database;
        _userBox.Text = string.IsNullOrWhiteSpace(current.Db.User) ? "nusacbt_app" : current.Db.User;

        var layout = new TableLayoutPanel
        {
            Dock = DockStyle.Fill,
            Padding = new Padding(16),
            ColumnCount = 2,
            AutoScroll = true,
        };
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 38));
        layout.ColumnStyles.Add(new ColumnStyle(SizeType.Percent, 62));

        AddRow(layout, "Host PostgreSQL:", _hostBox);
        AddRow(layout, "Port PostgreSQL:", _portNum);
        AddRow(layout, "Nama Database (UTF8):", _dbBox);
        AddRow(layout, "User Aplikasi Database:", _userBox);
        AddRow(layout, "Sandi User Database:", _passBox);

        layout.Controls.Add(_createDbCheck, 0, layout.RowCount);
        layout.SetColumnSpan(_createDbCheck, 2);
        layout.RowCount++;

        AddRow(layout, "Superuser Postgres:", _pgAdminUserBox);
        AddRow(layout, "Sandi Superuser Postgres:", _pgAdminPassBox);

        layout.Controls.Add(_cookieSecureCheck, 0, layout.RowCount);
        layout.SetColumnSpan(_cookieSecureCheck, 2);
        layout.RowCount++;

        var adminNeeded = current.Db.AdminCount == 0;
        var adminHeader = new Label
        {
            Text = adminNeeded
                ? "Akun Superadmin Pertama (Wajib jika DB baru):"
                : "Akun Superadmin sudah ada di database (kosongkan jika tidak perlu):",
            AutoSize = true,
            Font = new Font(Font, FontStyle.Bold),
            Padding = new Padding(0, 8, 0, 4),
        };
        layout.Controls.Add(adminHeader, 0, layout.RowCount);
        layout.SetColumnSpan(adminHeader, 2);
        layout.RowCount++;

        _adminUserBox.Enabled = adminNeeded;
        _adminPassBox.Enabled = adminNeeded;
        _adminConfirmBox.Enabled = adminNeeded;
        AddRow(layout, "Username Admin Awal:", _adminUserBox);
        AddRow(layout, "Sandi Admin (12+ kar):", _adminPassBox);
        AddRow(layout, "Ulangi Sandi Admin:", _adminConfirmBox);

        var note = new Label
        {
            Text = $"Folder data persisten: {AppPaths.DataDir}\nKunci enkripsi akan dibuat otomatis di luar folder program dan tidak akan tertimpa saat update.",
            AutoSize = true,
            ForeColor = Color.DimGray,
            Padding = new Padding(0, 6, 0, 6),
        };
        layout.Controls.Add(note, 0, layout.RowCount);
        layout.SetColumnSpan(note, 2);
        layout.RowCount++;

        layout.Controls.Add(_statusLabel, 0, layout.RowCount);
        layout.SetColumnSpan(_statusLabel, 2);
        layout.RowCount++;

        var btnPanel = new FlowLayoutPanel
        {
            Dock = DockStyle.Bottom,
            FlowDirection = FlowDirection.RightToLeft,
            Padding = new Padding(16, 8, 16, 14),
            AutoSize = true,
        };
        _cancelBtn.Click += (_, _) => { DialogResult = DialogResult.Cancel; Close(); };
        _saveBtn.Click += async (_, _) => await RunSetupAsync(adminNeeded);
        btnPanel.Controls.Add(_cancelBtn);
        btnPanel.Controls.Add(_saveBtn);

        _createDbCheck.CheckedChanged += (_, _) =>
        {
            _pgAdminUserBox.Enabled = _createDbCheck.Checked;
            _pgAdminPassBox.Enabled = _createDbCheck.Checked;
        };

        Controls.Add(layout);
        Controls.Add(btnPanel);
        AcceptButton = _saveBtn;
        CancelButton = _cancelBtn;
    }

    private static void AddRow(TableLayoutPanel panel, string labelText, Control control)
    {
        var row = panel.RowCount++;
        panel.RowStyles.Add(new RowStyle(SizeType.AutoSize));
        panel.Controls.Add(new Label { Text = labelText, AutoSize = true, Anchor = AnchorStyles.Left, Padding = new Padding(0, 6, 0, 6) }, 0, row);
        control.Margin = new Padding(0, 3, 0, 3);
        panel.Controls.Add(control, 1, row);
    }

    private async Task RunSetupAsync(bool adminNeeded)
    {
        _statusLabel.ForeColor = Color.DarkRed;
        if (string.IsNullOrWhiteSpace(_passBox.Text))
        {
            _statusLabel.Text = "Kata sandi user aplikasi database wajib diisi.";
            return;
        }
        if (_createDbCheck.Checked && string.IsNullOrWhiteSpace(_pgAdminPassBox.Text))
        {
            _statusLabel.Text = "Kata sandi superuser Postgres wajib diisi jika pembuatan database otomatis dicentang.";
            return;
        }
        if (adminNeeded)
        {
            if (_adminPassBox.Text.Length < 12)
            {
                _statusLabel.Text = "Sandi admin awal minimal 12 karakter.";
                return;
            }
            if (_adminPassBox.Text != _adminConfirmBox.Text)
            {
                _statusLabel.Text = "Konfirmasi sandi admin awal tidak sama.";
                return;
            }
        }

        _saveBtn.Enabled = false;
        _cancelBtn.Enabled = false;
        _statusLabel.ForeColor = Color.RoyalBlue;
        _statusLabel.Text = "Menyiapkan database, kunci enkripsi, dan migrasi...";

        try
        {
            var req = new SetupRequest
            {
                Host = _hostBox.Text.Trim(),
                Port = (int)_portNum.Value,
                Database = _dbBox.Text.Trim(),
                User = _userBox.Text.Trim(),
                Password = _passBox.Text,
                CreateDbIfMissing = _createDbCheck.Checked,
                AdminUser = _pgAdminUserBox.Text.Trim(),
                AdminPassword = _pgAdminPassBox.Text,
                CookieSecure = _cookieSecureCheck.Checked,
                InitialAdminUsername = _adminUserBox.Text.Trim(),
                InitialAdminPassword = _adminPassBox.Text,
            };

            var res = await PreflightRunner.SetupAsync(req);
            if (!res.Ok)
            {
                _statusLabel.ForeColor = Color.DarkRed;
                _statusLabel.Text = res.Error ?? "Pengaturan gagal dijalankan.";
                return;
            }

            WindowsSystemHelper.TryRestrictKeysDirectory(AppPaths.KeysDir);
            DialogResult = DialogResult.OK;
            Close();
        }
        catch (Exception ex)
        {
            _statusLabel.ForeColor = Color.DarkRed;
            _statusLabel.Text = ex.Message;
        }
        finally
        {
            _saveBtn.Enabled = true;
            _cancelBtn.Enabled = true;
        }
    }
}
