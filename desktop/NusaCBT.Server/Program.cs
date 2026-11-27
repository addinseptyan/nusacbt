namespace NusaCBT.Server;

internal static class Program
{
    [STAThread]
    private static void Main()
    {
        using var singleInstance = new Mutex(true, "Local\\NusaCBT_Server_Launcher_Mutex", out var isOwner);
        if (!isOwner)
        {
            MessageBox.Show(
                "Aplikasi NusaCBT Server Launcher sudah berjalan. Periksa ikon di System Tray Windows.",
                "NusaCBT Server",
                MessageBoxButtons.OK,
                MessageBoxIcon.Information);
            return;
        }

        ApplicationConfiguration.Initialize();
        Application.ThreadException += (_, e) =>
        {
            MessageBox.Show(
                $"Terjadi kesalahan tak terduga pada launcher:\n{e.Exception.Message}",
                "Kesalahan NusaCBT Server",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
        };

        Application.Run(new MainForm());
    }
}
