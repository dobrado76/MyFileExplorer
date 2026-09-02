using System.Diagnostics;
using System.Text.Json;

namespace MfeShellLauncher;

internal static class Program
{
    private const string LauncherVersion = "1.0.0";

    public static int Main(string[] args)
    {
        if (args.Any(a => string.Equals(a, "--restore-shell-redirect", StringComparison.OrdinalIgnoreCase)))
            return RestoreShellRedirect.Run();

        if (args.Length < 2)
            return 2;

        var verb = args[0].Trim();
        var target = args[1].Trim().Trim('"');
        var action = "error";
        var exitCode = 0;

        try
        {
            var baseDir = AppContext.BaseDirectory.TrimEnd('\\', '/');
            var mfeExe = Path.Combine(baseDir, "MyFileExplorer.exe");

            var kind = TargetClassifier.Classify(target);
            switch (kind)
            {
                case TargetKind.Directory:
                    action = "mfe-open";
                    exitCode = SpawnDetached(mfeExe, ["--open", target]) ? 0 : 1;
                    break;
                case TargetKind.File:
                    action = "mfe-reveal";
                    exitCode = SpawnDetached(mfeExe, ["--reveal", target]) ? 0 : 1;
                    break;
                default:
                    action = "explorer-fallback";
                    exitCode = SpawnExplorer(target) ? 0 : 1;
                    break;
            }
        }
        catch
        {
            action = "error";
            exitCode = 1;
        }
        finally
        {
            InvocationLog.Append(verb, target, action, LauncherVersion);
        }

        return exitCode;
    }

    private static bool SpawnDetached(string exe, IReadOnlyList<string> argList)
    {
        if (!File.Exists(exe)) return false;
        var psi = new ProcessStartInfo
        {
            FileName = exe,
            UseShellExecute = false,
            CreateNoWindow = true
        };
        foreach (var a in argList) psi.ArgumentList.Add(a);
        using var p = Process.Start(psi);
        return p != null;
    }

    private static bool SpawnExplorer(string target)
    {
        var psi = new ProcessStartInfo
        {
            FileName = "explorer.exe",
            UseShellExecute = false,
            CreateNoWindow = true
        };
        psi.ArgumentList.Add(target);
        using var p = Process.Start(psi);
        return p != null;
    }
}

internal enum TargetKind
{
    Directory,
    File,
    Unsupported
}

internal static class TargetClassifier
{
    public static TargetKind Classify(string raw)
    {
        var target = raw.Trim().Trim('"');
        if (string.IsNullOrEmpty(target)) return TargetKind.Unsupported;
        if (target.StartsWith("::{", StringComparison.Ordinal) || target.StartsWith("shell:", StringComparison.OrdinalIgnoreCase))
            return TargetKind.Unsupported;

        if (!LooksLikeFilesystemPath(target)) return TargetKind.Unsupported;

        try
        {
            if (File.Exists(target)) return TargetKind.File;
            if (Directory.Exists(target)) return TargetKind.Directory;
        }
        catch
        {
            return TargetKind.Unsupported;
        }

        return TargetKind.Unsupported;
    }

    private static bool LooksLikeFilesystemPath(string target)
    {
        if (target.Length >= 2 && char.IsLetter(target[0]) && target[1] == ':') return true;
        if (target.StartsWith(@"\\", StringComparison.Ordinal)) return true;
        return false;
    }
}

internal static class InvocationLog
{
    public static void Append(string verb, string target, string action, string launcherVersion)
    {
        try
        {
            var dir = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "MyFileExplorer",
                "shell-redirect");
            Directory.CreateDirectory(dir);
            var line = JsonSerializer.Serialize(new
            {
                timestamp = DateTime.UtcNow.ToString("o"),
                verb,
                target,
                action,
                launcherVersion
            });
            File.AppendAllText(Path.Combine(dir, "invocations.jsonl"), line + Environment.NewLine);
        }
        catch
        {
            // never block shell
        }
    }
}
