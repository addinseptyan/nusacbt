namespace NusaCBT.Server;

internal static class AppPaths
{
    public static string BaseDir { get; } = AppContext.BaseDirectory.TrimEnd(Path.DirectorySeparatorChar, Path.AltDirectorySeparatorChar);

    public static string RuntimeDir => Path.Combine(BaseDir, "runtime");
    public static string NodeExe => Path.Combine(RuntimeDir, "node.exe");
    public static string AppDir => Path.Combine(BaseDir, "app");
    public static string ServerEntry => Path.Combine(AppDir, "server-entry.mjs");
    public static string LauncherCli => Path.Combine(AppDir, "scripts", "launcher-cli.mjs");

    public static string DataDir { get; } = ResolveDataDir();
    public static string EnvFile => Path.Combine(DataDir, ".env.local");
    public static string KeysDir => Path.Combine(DataDir, "keys");
    public static string LogsDir => Path.Combine(DataDir, "logs");
    public static string SettingsFile => Path.Combine(DataDir, "launcher-settings.json");

    private static string ResolveDataDir()
    {
        var portableData = Path.Combine(BaseDir, "data");
        if (Directory.Exists(portableData) && File.Exists(Path.Combine(portableData, ".env.local")))
        {
            return portableData;
        }

        var programFiles = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles);
        var programFilesX86 = Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86);
        var underProgramFiles =
            (!string.IsNullOrEmpty(programFiles) && BaseDir.StartsWith(programFiles, StringComparison.OrdinalIgnoreCase)) ||
            (!string.IsNullOrEmpty(programFilesX86) && BaseDir.StartsWith(programFilesX86, StringComparison.OrdinalIgnoreCase));

        if (!underProgramFiles && Directory.Exists(portableData))
        {
            return portableData;
        }

        var commonData = Environment.GetFolderPath(Environment.SpecialFolder.CommonApplicationData);
        return Path.Combine(commonData, "NusaCBT");
    }
}
