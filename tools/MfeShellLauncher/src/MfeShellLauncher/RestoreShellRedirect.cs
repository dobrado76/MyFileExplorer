using System.Diagnostics;
using System.Text.Json;

namespace MfeShellLauncher;

/// <summary>
/// Standalone registry restore for uninstall — reads the same backup manifest as MFE main.
/// Uninstall must never trap the user: if redirect is not active in the registry, succeed
/// even when a stale/incomplete backup.json is left under AppData.
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

            // Gate on the live registry — not Settings UI / leftover backup files.
            // Windows integration "off" means our launcher is not the handler; uninstall
            // must succeed even if backup.json is stale, incomplete, or corrupt.
            if (!ManagedCommandsReferenceLauncher())
            {
                if (File.Exists(manifestPath))
                    ClearBackupArtifacts(dir);
                return 0;
            }

            if (TryExactRestore(dir, manifestPath))
                return 0;

            // Backup missing/broken but we are still the handler — detach so Explorer works.
            EmergencyDetachLauncher();
            if (!ManagedCommandsReferenceLauncher())
            {
                ClearBackupArtifacts(dir);
                return 0;
            }

            return 1;
        }
        catch
        {
            try { EmergencyDetachLauncher(); } catch { /* ignore */ }
            return ManagedCommandsReferenceLauncher() ? 1 : 0;
        }
    }

    private static bool TryExactRestore(string dir, string manifestPath)
    {
        if (!File.Exists(manifestPath)) return false;

        try
        {
            var json = File.ReadAllText(manifestPath);
            using var doc = JsonDocument.Parse(json);
            var root = doc.RootElement;
            if (!root.TryGetProperty("version", out var ver) || ver.GetInt32() != 1)
                return false;
            if (!root.TryGetProperty("subtrees", out var subtrees))
                return false;

            foreach (var subtree in Subtrees)
            {
                if (!subtrees.TryGetProperty(subtree, out var entry))
                    return false;

                var existed = entry.TryGetProperty("existedBefore", out var eb) && eb.GetBoolean();
                var regFile = entry.TryGetProperty("regFile", out var rf) ? rf.GetString() ?? "" : "";
                var key = $@"HKCU\Software\Classes\{subtree}";

                if (existed)
                {
                    if (string.IsNullOrWhiteSpace(regFile) || !File.Exists(regFile))
                        return false;
                    TryDeleteTree(key);
                    RunReg("import", regFile);
                }
                else
                {
                    TryDeleteTree(key);
                }
            }

            if (ManagedCommandsReferenceLauncher())
                return false;

            ClearBackupArtifacts(dir);
            return true;
        }
        catch
        {
            return false;
        }
    }

    /// <summary>
    /// Last resort: remove managed HKCU verb trees that still point at us.
    /// Explorer then uses the system default for Directory open/explore.
    /// </summary>
    private static void EmergencyDetachLauncher()
    {
        foreach (var subtree in Subtrees)
        {
            var commandKey = $@"HKCU\Software\Classes\{subtree}\command";
            if (!CommandDefaultReferencesLauncher(commandKey)) continue;
            TryDeleteTree($@"HKCU\Software\Classes\{subtree}");
        }
    }

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
