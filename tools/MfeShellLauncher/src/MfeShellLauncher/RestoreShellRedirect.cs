using System.Diagnostics;
using System.Text.Json;

namespace MfeShellLauncher;

/// <summary>
/// Standalone registry restore for uninstall — reads the same backup manifest as MFE main process.
/// Fail-closed: never deletes open/explore without a valid backup; verifies reg.exe; delete-then-import.
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
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "MyFileExplorer",
                "shell-redirect");
            var manifestPath = Path.Combine(dir, "backup.json");

            var launcherStillReferenced = ManagedCommandsReferenceLauncher();
            if (!File.Exists(manifestPath))
            {
                // Nothing to restore — only OK when we are not still the handler.
                return launcherStillReferenced ? 1 : 0;
            }

            var json = File.ReadAllText(manifestPath);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (!root.TryGetProperty("version", out var ver) || ver.GetInt32() != 1)
                return FailClosed(launcherStillReferenced);
            if (!root.TryGetProperty("subtrees", out var subtrees))
                return FailClosed(launcherStillReferenced);

            foreach (var subtree in Subtrees)
            {
                if (!subtrees.TryGetProperty(subtree, out var entry))
                    return 1;

                var existed = entry.TryGetProperty("existedBefore", out var eb) && eb.GetBoolean();
                var regFile = entry.TryGetProperty("regFile", out var rf) ? rf.GetString() ?? "" : "";
                var key = $@"HKCU\Software\Classes\{subtree}";

                if (existed)
                {
                    if (string.IsNullOrWhiteSpace(regFile) || !File.Exists(regFile))
                        return 1;
                    // Exact restore: wipe live subtree, then import snapshot.
                    TryDeleteTree(key);
                    RunReg("import", regFile);
                }
                else
                {
                    // Backup recorded that this key did not exist — only then delete.
                    TryDeleteTree(key);
                }
            }

            if (ManagedCommandsReferenceLauncher())
                return 1;

            ClearBackupArtifacts(dir);
            return 0;
        }
        catch
        {
            return 1;
        }
    }

    private static int FailClosed(bool launcherStillReferenced) =>
        launcherStillReferenced ? 1 : 0;

    private static bool ManagedCommandsReferenceLauncher()
    {
        foreach (var subtree in Subtrees)
        {
            var key = $@"HKCU\Software\Classes\{subtree}\command";
            if (CommandDefaultReferencesLauncher(key)) return true;
        }
        return false;
    }

    private static bool CommandDefaultReferencesLauncher(string key)
    {
        try
        {
            var output = RunRegCapture("query", key, "/ve");
            return output.Contains("MfeShellLauncher.exe", StringComparison.OrdinalIgnoreCase);
        }
        catch
        {
            return false;
        }
    }

    private static void TryDeleteTree(string key)
    {
        try
        {
            RunReg("delete", key, "/f");
        }
        catch (Exception ex) when (IsRegNotFound(ex))
        {
            /* already gone */
        }
    }

    private static void ClearBackupArtifacts(string dir)
    {
        try
        {
            var manifest = Path.Combine(dir, "backup.json");
            if (File.Exists(manifest)) File.Delete(manifest);
        }
        catch
        {
            /* ignore */
        }

        foreach (var subtree in Subtrees)
        {
            try
            {
                var safe = subtree.Replace('\\', '-');
                var reg = Path.Combine(dir, $"{safe}.reg");
                if (File.Exists(reg)) File.Delete(reg);
            }
            catch
            {
                /* ignore */
            }
        }
    }

    private static bool IsRegNotFound(Exception ex)
    {
        var text = ex.Message;
        return text.Contains("unable to find the specified registry key", StringComparison.OrdinalIgnoreCase)
               || text.Contains("cannot find the file specified", StringComparison.OrdinalIgnoreCase);
    }

    private static void RunReg(params string[] args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "reg.exe",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)
            ?? throw new InvalidOperationException("Failed to start reg.exe");
        var stderr = p.StandardError.ReadToEnd();
        var stdout = p.StandardOutput.ReadToEnd();
        if (!p.WaitForExit(15_000))
        {
            try { p.Kill(entireProcessTree: true); } catch { /* ignore */ }
            throw new TimeoutException("reg.exe timed out");
        }
        if (p.ExitCode != 0)
            throw new InvalidOperationException($"reg.exe exit {p.ExitCode}: {stderr} {stdout}".Trim());
    }

    private static string RunRegCapture(params string[] args)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "reg.exe",
            UseShellExecute = false,
            CreateNoWindow = true,
            RedirectStandardOutput = true,
            RedirectStandardError = true
        };
        foreach (var a in args) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi)
            ?? throw new InvalidOperationException("Failed to start reg.exe");
        var stdout = p.StandardOutput.ReadToEnd();
        var stderr = p.StandardError.ReadToEnd();
        if (!p.WaitForExit(15_000))
        {
            try { p.Kill(entireProcessTree: true); } catch { /* ignore */ }
            throw new TimeoutException("reg.exe timed out");
        }
        if (p.ExitCode != 0)
            throw new InvalidOperationException($"reg.exe exit {p.ExitCode}: {stderr} {stdout}".Trim());
        return stdout;
    }
}
