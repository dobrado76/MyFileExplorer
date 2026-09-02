using System.Diagnostics;
using System.Text.Json;

namespace MfeShellLauncher;

/// <summary>
/// Standalone registry restore for uninstall — reads the same backup manifest as MFE main process.
/// </summary>
internal static class RestoreShellRedirect
{
    private static readonly string[] Subtrees =
    [
        @"Directory\shell\open",
        @"Directory\shell\explore"
    ];

    public static int Run()
    {
        try
        {
            var manifestPath = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "MyFileExplorer",
                "shell-redirect",
                "backup.json");
            if (!File.Exists(manifestPath)) return 0;

            var json = File.ReadAllText(manifestPath);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (!root.TryGetProperty("subtrees", out var subtrees)) return 0;

            foreach (var subtree in Subtrees)
            {
                if (!subtrees.TryGetProperty(subtree, out var entry)) continue;
                var existed = entry.TryGetProperty("existedBefore", out var eb) && eb.GetBoolean();
                var regFile = entry.TryGetProperty("regFile", out var rf) ? rf.GetString() ?? "" : "";
                var key = $@"HKCU\Software\Classes\{subtree}";

                if (existed && !string.IsNullOrWhiteSpace(regFile) && File.Exists(regFile))
                {
                    RunReg("import", regFile);
                }
                else
                {
                    RunReg("delete", key, "/f");
                }
            }

            return 0;
        }
        catch
        {
            return 1;
        }
    }

    private static void RunReg(params string[] args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "reg.exe",
            UseShellExecute = false,
            CreateNoWindow = true
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi);
        p?.WaitForExit(15_000);
    }
}
