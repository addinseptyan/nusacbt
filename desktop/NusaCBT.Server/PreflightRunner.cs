using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.Json.Serialization;

namespace NusaCBT.Server;

internal sealed class KeysStatus
{
    [JsonPropertyName("participantPath")] public string ParticipantPath { get; set; } = "";
    [JsonPropertyName("participantOk")] public bool ParticipantOk { get; set; }
    [JsonPropertyName("participantReason")] public string ParticipantReason { get; set; } = "";
    [JsonPropertyName("tokenPath")] public string TokenPath { get; set; } = "";
    [JsonPropertyName("tokenOk")] public bool TokenOk { get; set; }
    [JsonPropertyName("tokenReason")] public string TokenReason { get; set; } = "";
    [JsonPropertyName("keysDistinct")] public bool KeysDistinct { get; set; }
}

internal sealed class DbStatus
{
    [JsonPropertyName("configured")] public bool Configured { get; set; }
    [JsonPropertyName("host")] public string Host { get; set; } = "127.0.0.1";
    [JsonPropertyName("port")] public int Port { get; set; } = 5432;
    [JsonPropertyName("database")] public string Database { get; set; } = "nusacbt";
    [JsonPropertyName("user")] public string User { get; set; } = "nusacbt_app";
    [JsonPropertyName("connected")] public bool Connected { get; set; }
    [JsonPropertyName("isUtf8")] public bool IsUtf8 { get; set; }
    [JsonPropertyName("encoding")] public string Encoding { get; set; } = "";
    [JsonPropertyName("appliedMigrations")] public int AppliedMigrations { get; set; }
    [JsonPropertyName("totalMigrations")] public int TotalMigrations { get; set; }
    [JsonPropertyName("pendingMigrations")] public int PendingMigrations { get; set; }
    [JsonPropertyName("adminCount")] public int AdminCount { get; set; }
    [JsonPropertyName("activeAttemptsCount")] public int ActiveAttemptsCount { get; set; }
    [JsonPropertyName("errorCode")] public string ErrorCode { get; set; } = "";
    [JsonPropertyName("error")] public string Error { get; set; } = "";
}

internal sealed class PreflightStatus
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("version")] public string Version { get; set; } = "";
    [JsonPropertyName("tag")] public string Tag { get; set; } = "";
    [JsonPropertyName("appDir")] public string AppDir { get; set; } = "";
    [JsonPropertyName("dataDir")] public string DataDir { get; set; } = "";
    [JsonPropertyName("appReady")] public bool AppReady { get; set; }
    [JsonPropertyName("envFile")] public string EnvFile { get; set; } = "";
    [JsonPropertyName("envExists")] public bool EnvExists { get; set; }
    [JsonPropertyName("keys")] public KeysStatus Keys { get; set; } = new();
    [JsonPropertyName("db")] public DbStatus Db { get; set; } = new();
    [JsonPropertyName("error")] public string? Error { get; set; }
}

internal sealed class CliActionResult
{
    [JsonPropertyName("ok")] public bool Ok { get; set; }
    [JsonPropertyName("error")] public string? Error { get; set; }
    [JsonPropertyName("applied")] public List<string>? Applied { get; set; }
    [JsonPropertyName("skipped")] public List<string>? Skipped { get; set; }
    [JsonPropertyName("activeAttempts")] public int ActiveAttempts { get; set; }
}

internal sealed class SetupRequest
{
    [JsonPropertyName("host")] public string Host { get; set; } = "127.0.0.1";
    [JsonPropertyName("port")] public int Port { get; set; } = 5432;
    [JsonPropertyName("database")] public string Database { get; set; } = "nusacbt";
    [JsonPropertyName("user")] public string User { get; set; } = "nusacbt_app";
    [JsonPropertyName("password")] public string Password { get; set; } = "";
    [JsonPropertyName("createDbIfMissing")] public bool CreateDbIfMissing { get; set; }
    [JsonPropertyName("adminUser")] public string AdminUser { get; set; } = "postgres";
    [JsonPropertyName("adminPassword")] public string AdminPassword { get; set; } = "";
    [JsonPropertyName("cookieSecure")] public bool CookieSecure { get; set; }
    [JsonPropertyName("initialAdminUsername")] public string InitialAdminUsername { get; set; } = "";
    [JsonPropertyName("initialAdminPassword")] public string InitialAdminPassword { get; set; } = "";
}

internal static class PreflightRunner
{
    private static readonly JsonSerializerOptions JsonOpts = new() { PropertyNameCaseInsensitive = true };

    private static async Task<(int ExitCode, string Stdout, string Stderr)> RunCliAsync(string command, string? stdinJson = null)
    {
        if (!File.Exists(AppPaths.NodeExe) || !File.Exists(AppPaths.LauncherCli))
        {
            return (-1, "", "Runtime Node.js atau launcher-cli.mjs belum lengkap.");
        }

        var psi = new ProcessStartInfo(AppPaths.NodeExe)
        {
            WorkingDirectory = AppPaths.AppDir,
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            RedirectStandardInput = stdinJson is not null,
            StandardOutputEncoding = Encoding.UTF8,
            StandardErrorEncoding = Encoding.UTF8,
        };
        psi.ArgumentList.Add(AppPaths.LauncherCli);
        psi.ArgumentList.Add(command);
        psi.ArgumentList.Add("--data-dir");
        psi.ArgumentList.Add(AppPaths.DataDir);

        using var proc = Process.Start(psi) ?? throw new InvalidOperationException("Gagal menjalankan runtime Node.");
        if (stdinJson is not null)
        {
            await proc.StandardInput.WriteAsync(stdinJson);
            proc.StandardInput.Close();
        }

        var stdoutTask = proc.StandardOutput.ReadToEndAsync();
        var stderrTask = proc.StandardError.ReadToEndAsync();
        await proc.WaitForExitAsync();
        return (proc.ExitCode, await stdoutTask, await stderrTask);
    }

    public static async Task<PreflightStatus> CheckAsync()
    {
        try
        {
            var (exit, stdout, stderr) = await RunCliAsync("check");
            var jsonLine = ExtractLastJsonLine(stdout);
            if (string.IsNullOrWhiteSpace(jsonLine))
            {
                return new PreflightStatus
                {
                    Ok = false,
                    DataDir = AppPaths.DataDir,
                    AppDir = AppPaths.AppDir,
                    Error = string.IsNullOrWhiteSpace(stderr) ? $"Gagal memeriksa dependensi (kode {exit})." : stderr.Trim(),
                };
            }
            return JsonSerializer.Deserialize<PreflightStatus>(jsonLine, JsonOpts)
                ?? new PreflightStatus { Ok = false, Error = "Respons check tidak valid." };
        }
        catch (Exception ex)
        {
            return new PreflightStatus
            {
                Ok = false,
                DataDir = AppPaths.DataDir,
                AppDir = AppPaths.AppDir,
                Error = $"Gagal membaca status preflight: {ex.Message}",
            };
        }
    }

    public static async Task<CliActionResult> SetupAsync(SetupRequest req)
    {
        try
        {
            var json = JsonSerializer.Serialize(req);
            var (_, stdout, stderr) = await RunCliAsync("setup", json);
            var jsonLine = ExtractLastJsonLine(stdout);
            if (string.IsNullOrWhiteSpace(jsonLine))
            {
                return new CliActionResult { Ok = false, Error = string.IsNullOrWhiteSpace(stderr) ? "Setup gagal dijalankan." : stderr.Trim() };
            }
            return JsonSerializer.Deserialize<CliActionResult>(jsonLine, JsonOpts)
                ?? new CliActionResult { Ok = false, Error = "Respons setup tidak valid." };
        }
        catch (Exception ex)
        {
            return new CliActionResult { Ok = false, Error = ex.Message };
        }
    }

    public static async Task<CliActionResult> MigrateAsync()
    {
        try
        {
            var (_, stdout, stderr) = await RunCliAsync("migrate");
            var jsonLine = ExtractLastJsonLine(stdout);
            if (string.IsNullOrWhiteSpace(jsonLine))
            {
                return new CliActionResult { Ok = false, Error = string.IsNullOrWhiteSpace(stderr) ? "Migrasi gagal dijalankan." : stderr.Trim() };
            }
            return JsonSerializer.Deserialize<CliActionResult>(jsonLine, JsonOpts)
                ?? new CliActionResult { Ok = false, Error = "Respons migrasi tidak valid." };
        }
        catch (Exception ex)
        {
            return new CliActionResult { Ok = false, Error = ex.Message };
        }
    }

    public static async Task<int> GetActiveExamsCountAsync()
    {
        try
        {
            var (_, stdout, _) = await RunCliAsync("active-exams");
            var jsonLine = ExtractLastJsonLine(stdout);
            if (string.IsNullOrWhiteSpace(jsonLine)) return 0;
            var res = JsonSerializer.Deserialize<CliActionResult>(jsonLine, JsonOpts);
            return res?.ActiveAttempts ?? 0;
        }
        catch
        {
            return 0;
        }
    }

    private static string? ExtractLastJsonLine(string? stdout)
    {
        if (string.IsNullOrWhiteSpace(stdout)) return null;
        var lines = stdout.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries);
        for (var i = lines.Length - 1; i >= 0; i--)
        {
            var trimmed = lines[i].Trim();
            if (trimmed.StartsWith('{') && trimmed.EndsWith('}'))
            {
                return trimmed;
            }
        }
        return stdout.Trim();
    }
}
