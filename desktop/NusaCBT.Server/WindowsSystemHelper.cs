using System.Diagnostics;
using System.Net;
using System.Net.NetworkInformation;
using System.Net.Sockets;
using Microsoft.Win32;

namespace NusaCBT.Server;

internal sealed record PostgresServiceInfo(string ServiceName, string DisplayName, string State)
{
    public bool IsRunning => State.Equals("RUNNING", StringComparison.OrdinalIgnoreCase);
}

internal static class WindowsSystemHelper
{
    public static List<PostgresServiceInfo> FindPostgresServices()
    {
        var result = new List<PostgresServiceInfo>();
        try
        {
            using var servicesKey = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services");
            if (servicesKey is null) return result;

            foreach (var name in servicesKey.GetSubKeyNames())
            {
                if (!name.StartsWith("postgresql", StringComparison.OrdinalIgnoreCase)) continue;
                using var svcKey = servicesKey.OpenSubKey(name);
                var displayName = svcKey?.GetValue("DisplayName")?.ToString() ?? name;
                var state = QueryServiceState(name);
                result.Add(new PostgresServiceInfo(name, displayName, state));
            }
        }
        catch
        {
            // Abaikan error pembacaan registry jika dibatasi kebijakan lokal.
        }
        return result.OrderByDescending(s => s.ServiceName, StringComparer.OrdinalIgnoreCase).ToList();
    }

    public static string QueryServiceState(string serviceName)
    {
        try
        {
            var psi = new ProcessStartInfo("sc.exe", $"query \"{serviceName}\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using var proc = Process.Start(psi);
            if (proc is null) return "UNKNOWN";
            var output = proc.StandardOutput.ReadToEnd();
            proc.WaitForExit(3000);

            foreach (var line in output.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
            {
                if (!line.Contains("STATE", StringComparison.OrdinalIgnoreCase)) continue;
                if (line.Contains("RUNNING", StringComparison.OrdinalIgnoreCase)) return "RUNNING";
                if (line.Contains("STOPPED", StringComparison.OrdinalIgnoreCase)) return "STOPPED";
                if (line.Contains("START_PENDING", StringComparison.OrdinalIgnoreCase)) return "START_PENDING";
                if (line.Contains("STOP_PENDING", StringComparison.OrdinalIgnoreCase)) return "STOP_PENDING";
            }
        }
        catch
        {
            // Abaikan kegagalan kueri service.
        }
        return "UNKNOWN";
    }

    public static async Task<(bool Ok, string Message)> StartPostgresServiceAsync(string serviceName)
    {
        try
        {
            var directPsi = new ProcessStartInfo("sc.exe", $"start \"{serviceName}\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
            };
            using var directProc = Process.Start(directPsi);
            if (directProc is not null)
            {
                await directProc.WaitForExitAsync();
                if (directProc.ExitCode != 0)
                {
                    var elevatedPsi = new ProcessStartInfo("sc.exe", $"start \"{serviceName}\"")
                    {
                        UseShellExecute = true,
                        Verb = "runas",
                        WindowStyle = ProcessWindowStyle.Hidden,
                    };
                    using var elevatedProc = Process.Start(elevatedPsi);
                    if (elevatedProc is not null) await elevatedProc.WaitForExitAsync();
                }
            }

            for (var i = 0; i < 20; i++)
            {
                await Task.Delay(500);
                if (QueryServiceState(serviceName).Equals("RUNNING", StringComparison.OrdinalIgnoreCase))
                {
                    return (true, $"Service {serviceName} berhasil dijalankan.");
                }
            }
            return (false, $"Service {serviceName} belum berstatus RUNNING. Periksa Services.msc.");
        }
        catch (Exception ex)
        {
            return (false, $"Gagal menyalakan {serviceName}: {ex.Message}");
        }
    }

    public static List<string> GetLanIPv4Addresses()
    {
        var ips = new List<string>();
        try
        {
            foreach (var nic in NetworkInterface.GetAllNetworkInterfaces())
            {
                if (nic.OperationalStatus != OperationalStatus.Up) continue;
                if (nic.NetworkInterfaceType is NetworkInterfaceType.Loopback or NetworkInterfaceType.Tunnel) continue;
                foreach (var addr in nic.GetIPProperties().UnicastAddresses)
                {
                    if (addr.Address.AddressFamily != AddressFamily.InterNetwork) continue;
                    var ipStr = addr.Address.ToString();
                    if (IPAddress.IsLoopback(addr.Address) || ipStr.StartsWith("169.254.", StringComparison.Ordinal)) continue;
                    if (!ips.Contains(ipStr, StringComparer.Ordinal)) ips.Add(ipStr);
                }
            }
        }
        catch
        {
            // Abaikan error enumerasi jaringan.
        }
        return ips;
    }

    public static bool IsTcpPortAvailable(int port)
    {
        try
        {
            var listeners = IPGlobalProperties.GetIPGlobalProperties().GetActiveTcpListeners();
            return !listeners.Any(ep => ep.Port == port);
        }
        catch
        {
            return true;
        }
    }

    public static async Task<(bool Ok, string Message)> AllowPortInFirewallAsync(int port)
    {
        try
        {
            var script = $"netsh advfirewall firewall delete rule name=\"NusaCBT Server\" >nul 2>&1 & netsh advfirewall firewall add rule name=\"NusaCBT Server\" dir=in action=allow protocol=TCP localport={port}";
            var psi = new ProcessStartInfo("cmd.exe", $"/c {script}")
            {
                UseShellExecute = true,
                Verb = "runas",
                WindowStyle = ProcessWindowStyle.Hidden,
            };
            using var proc = Process.Start(psi);
            if (proc is null) return (false, "Tidak dapat membuka dialog UAC untuk Windows Firewall.");
            await proc.WaitForExitAsync();
            return proc.ExitCode == 0
                ? (true, $"Aturan Windows Firewall TCP port {port} berhasil ditambahkan.")
                : (false, $"Gagal menambahkan aturan Windows Firewall (kode {proc.ExitCode}).");
        }
        catch (Exception ex)
        {
            return (false, $"Dibatalkan atau gagal: {ex.Message}");
        }
    }

    public static void TryRestrictKeysDirectory(string keysDir)
    {
        try
        {
            if (!Directory.Exists(keysDir)) return;
            var user = Environment.UserName;
            var psi = new ProcessStartInfo(
                "icacls.exe",
                $"\"{keysDir}\" /inheritance:r /grant:r \"SYSTEM:(OI)(CI)F\" \"Administrators:(OI)(CI)F\" \"{user}:(OI)(CI)F\"")
            {
                UseShellExecute = false,
                CreateNoWindow = true,
            };
            using var proc = Process.Start(psi);
            proc?.WaitForExit(3000);
        }
        catch
        {
            // Non-fatal jika pembatasan ACL tidak tersedia.
        }
    }
}
