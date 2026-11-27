using System.Net.Http.Headers;
using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace NusaCBT.Server;

internal sealed record ReleaseCheckResult(
    bool Ok,
    string CurrentVersion,
    string CurrentTag,
    bool NoReleaseYet,
    bool HasUpdate,
    string LatestVersion,
    string LatestTag,
    string ReleaseName,
    string PublishedAt,
    string Notes,
    string ReleaseUrl,
    string? PortableZipName,
    string? PortableZipUrl,
    long PortableZipSize,
    string? ChecksumsUrl,
    string? ErrorMessage
);

internal static partial class VersionUtils
{
    public const string GitHubRepo = "addinseptyan/nusacbt";

    [GeneratedRegex(@"^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$")]
    private static partial Regex SemverRegex();

    public static string CurrentVersion
    {
        get
        {
            var info = typeof(VersionUtils).Assembly
                .GetCustomAttribute<AssemblyInformationalVersionAttribute>()?
                .InformationalVersion;
            if (!string.IsNullOrWhiteSpace(info))
            {
                var plusIdx = info.IndexOf('+');
                var clean = plusIdx >= 0 ? info[..plusIdx] : info;
                if (TryParseSemver(clean, out _, out _, out _, out _))
                {
                    return clean.TrimStart('v');
                }
            }
            var ver = typeof(VersionUtils).Assembly.GetName().Version;
            return ver is null ? "1.0.1" : $"{ver.Major}.{ver.Minor}.{ver.Build}";
        }
    }

    public static string CurrentTag => $"v{CurrentVersion}";

    public static bool TryParseSemver(string? raw, out int major, out int minor, out int patch, out string prerelease)
    {
        major = 0;
        minor = 0;
        patch = 0;
        prerelease = "";
        if (string.IsNullOrWhiteSpace(raw)) return false;
        var match = SemverRegex().Match(raw.Trim());
        if (!match.Success) return false;
        major = int.Parse(match.Groups[1].Value);
        minor = int.Parse(match.Groups[2].Value);
        patch = int.Parse(match.Groups[3].Value);
        prerelease = match.Groups[4].Success ? match.Groups[4].Value : "";
        return true;
    }

    public static int CompareSemver(string a, string b)
    {
        if (!TryParseSemver(a, out var aMaj, out var aMin, out var aPat, out var aPre))
            throw new ArgumentException("Format versi A tidak valid.");
        if (!TryParseSemver(b, out var bMaj, out var bMin, out var bPat, out var bPre))
            throw new ArgumentException("Format versi B tidak valid.");

        if (aMaj != bMaj) return aMaj.CompareTo(bMaj);
        if (aMin != bMin) return aMin.CompareTo(bMin);
        if (aPat != bPat) return aPat.CompareTo(bPat);
        if (string.IsNullOrEmpty(aPre) && !string.IsNullOrEmpty(bPre)) return 1;
        if (!string.IsNullOrEmpty(aPre) && string.IsNullOrEmpty(bPre)) return -1;
        return string.Compare(aPre, bPre, StringComparison.Ordinal);
    }

    public static bool IsAllowedGitHubUrl(string? rawUrl)
    {
        if (!Uri.TryCreate(rawUrl, UriKind.Absolute, out var uri)) return false;
        if (!string.Equals(uri.Scheme, "https", StringComparison.OrdinalIgnoreCase)) return false;
        return uri.Host.Equals("github.com", StringComparison.OrdinalIgnoreCase)
            || uri.Host.Equals("objects.githubusercontent.com", StringComparison.OrdinalIgnoreCase)
            || uri.Host.Equals("release-assets.githubusercontent.com", StringComparison.OrdinalIgnoreCase);
    }

    public static async Task<ReleaseCheckResult> CheckLatestReleaseAsync(CancellationToken ct)
    {
        var current = CurrentVersion;
        var currentTag = CurrentTag;
        try
        {
            using var http = new HttpClient { Timeout = TimeSpan.FromSeconds(12) };
            http.DefaultRequestHeaders.Accept.Add(new MediaTypeWithQualityHeaderValue("application/vnd.github+json"));
            http.DefaultRequestHeaders.UserAgent.ParseAdd($"NusaCBT-Server/{current}");

            using var resp = await http.GetAsync($"https://api.github.com/repos/{GitHubRepo}/releases/latest", ct);
            if ((int)resp.StatusCode == 404)
            {
                return new ReleaseCheckResult(
                    true, current, currentTag, true, false, current, currentTag, "", "", "",
                    $"https://github.com/{GitHubRepo}/releases", null, null, 0, null, null);
            }

            if (!resp.IsSuccessStatusCode)
            {
                var err = (int)resp.StatusCode is 403 or 429
                    ? "Batas API GitHub sementara tercapai. Coba lagi beberapa menit lagi."
                    : $"Gagal memeriksa rilis GitHub (HTTP {(int)resp.StatusCode}).";
                return new ReleaseCheckResult(false, current, currentTag, false, false, current, currentTag, "", "", "", "", null, null, 0, null, err);
            }

            var json = await resp.Content.ReadAsStringAsync(ct);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;

            var tagName = root.TryGetProperty("tag_name", out var tagEl) ? (tagEl.GetString() ?? "").Trim() : "";
            if (!TryParseSemver(tagName, out var maj, out var min, out var pat, out var pre))
            {
                return new ReleaseCheckResult(false, current, currentTag, false, false, current, currentTag, "", "", "", "", null, null, 0, null,
                    "Tag rilis terbaru di GitHub tidak berformat SemVer yang valid.");
            }

            var latestVer = $"{maj}.{min}.{pat}{(string.IsNullOrEmpty(pre) ? "" : $"-{pre}")}";
            var latestTag = $"v{latestVer}";
            var hasUpdate = CompareSemver(latestVer, current) > 0;
            var releaseName = root.TryGetProperty("name", out var nameEl) ? (nameEl.GetString() ?? latestTag).Trim() : latestTag;
            var publishedAt = root.TryGetProperty("published_at", out var pubEl) ? (pubEl.GetString() ?? "") : "";
            var notes = root.TryGetProperty("body", out var bodyEl) ? (bodyEl.GetString() ?? "").Trim() : "";
            var htmlUrl = root.TryGetProperty("html_url", out var urlEl) ? urlEl.GetString() : null;
            var releaseUrl = IsAllowedGitHubUrl(htmlUrl) ? htmlUrl! : $"https://github.com/{GitHubRepo}/releases";

            string? zipName = null;
            string? zipUrl = null;
            long zipSize = 0;
            string? sumsUrl = null;

            if (root.TryGetProperty("assets", out var assetsEl) && assetsEl.ValueKind == JsonValueKind.Array)
            {
                foreach (var asset in assetsEl.EnumerateArray())
                {
                    var name = asset.TryGetProperty("name", out var an) ? (an.GetString() ?? "") : "";
                    var dl = asset.TryGetProperty("browser_download_url", out var ad) ? ad.GetString() : null;
                    var sz = asset.TryGetProperty("size", out var asz) && asz.TryGetInt64(out var parsedSize) ? parsedSize : 0;
                    if (string.IsNullOrWhiteSpace(name) || !IsAllowedGitHubUrl(dl)) continue;

                    if (name.EndsWith("-win64-portable.zip", StringComparison.OrdinalIgnoreCase) &&
                        name.StartsWith("NusaCBT-", StringComparison.OrdinalIgnoreCase))
                    {
                        zipName = name;
                        zipUrl = dl;
                        zipSize = sz;
                    }
                    else if (name.Equals("SHA256SUMS.txt", StringComparison.OrdinalIgnoreCase))
                    {
                        sumsUrl = dl;
                    }
                }
            }

            return new ReleaseCheckResult(
                true, current, currentTag, false, hasUpdate, latestVer, latestTag, releaseName,
                publishedAt, notes, releaseUrl, zipName, zipUrl, zipSize, sumsUrl, null);
        }
        catch (OperationCanceledException)
        {
            return new ReleaseCheckResult(false, current, currentTag, false, false, current, currentTag, "", "", "", "", null, null, 0, null,
                "Pemeriksaan pembaruan dibatalkan atau melebihi batas waktu.");
        }
        catch (Exception ex)
        {
            return new ReleaseCheckResult(false, current, currentTag, false, false, current, currentTag, "", "", "", "", null, null, 0, null,
                $"Tidak dapat terhubung ke GitHub: {ex.Message}. Anda tetap dapat memperbarui secara offline dari file ZIP.");
        }
    }

    public static string ComputeFileSha256(string filePath)
    {
        using var stream = File.OpenRead(filePath);
        var hash = SHA256.HashData(stream);
        return Convert.ToHexString(hash).ToLowerInvariant();
    }

    public static string? ExtractExpectedSha256(string sumsContent, string fileName)
    {
        foreach (var rawLine in sumsContent.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries))
        {
            var line = rawLine.Trim();
            if (string.IsNullOrEmpty(line)) continue;
            var parts = line.Split([' ', '\t'], StringSplitOptions.RemoveEmptyEntries);
            if (parts.Length < 2) continue;
            var hash = parts[0].Trim().ToLowerInvariant();
            var target = parts[^1].Trim().TrimStart('*');
            if (hash.Length == 64 && Path.GetFileName(target).Equals(fileName, StringComparison.OrdinalIgnoreCase))
            {
                return hash;
            }
        }
        return null;
    }
}
