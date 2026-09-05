using System.Diagnostics;
using System.Text.Json;

namespace MfeShellLauncher;

internal static class Program
{
    private const string LauncherVersion = "1.0.1";
    private const int InvocationsMaxLines = 500;

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
            var launch = ResolveMfeLaunch(baseDir);

            var kind = TargetClassifier.Classify(target);
            switch (kind)
            {
                case TargetKind.Directory:
                    {
                        var ok = SpawnDetached(launch.Exe, [.. launch.PrefixArgs, "--open", target]);
                        action = ok ? "mfe-open" : "error";
                        exitCode = ok ? 0 : 1;
                        break;
                    }
                case TargetKind.File:
                    {
                        var ok = SpawnDetached(launch.Exe, [.. launch.PrefixArgs, "--reveal", target]);
                        action = ok ? "mfe-reveal" : "error";
                        exitCode = ok ? 0 : 1;
                        break;
                    }
                default:
                    {
                        var ok = SpawnExplorer(target);
                        action = ok ? "explorer-fallback" : "error";
                        exitCode = ok ? 0 : 1;
                        break;
                    }
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

    private readonly record struct MfeLaunch(string Exe, string[] PrefixArgs);

    /// <summary>
    /// Prefer MyFileExplorer.exe beside the launcher (install layout).
    /// Fall back to %APPDATA%\MyFileExplorer\shell-redirect\target-exe.txt
    /// (line 1 = exe; further lines = argv before --open/--reveal — Electron + app path in dev).
    /// </summary>
    private static MfeLaunch ResolveMfeLaunch(string baseDir)
    {
        var beside = Path.Combine(baseDir, "MyFileExplorer.exe");
        if (File.Exists(beside)) return new MfeLaunch(beside, []);

        var env = Environment.GetEnvironmentVariable("MFE_EXE");
        if (!string.IsNullOrWhiteSpace(env) && File.Exists(env.Trim()))
            return new MfeLaunch(env.Trim(), []);

        try
        {
            var pointer = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData),
                "MyFileExplorer",
                "shell-redirect",
                "target-exe.txt");
            if (File.Exists(pointer))
            {
                var lines = File.ReadAllLines(pointer)
                    .Select(l => l.Trim())
                    .Where(l => l.Length > 0)
                    .ToArray();
                if (lines.Length > 0 && File.Exists(lines[0]!))
                {
                    // Prefix may be a directory (`electron .`) or a file (`out/main/index.js`).
                    var prefix = lines.Skip(1)
                        .Where(p => File.Exists(p) || Directory.Exists(p))
                        .ToArray();
                    return new MfeLaunch(lines[0]!, prefix);
                }
            }
        }
        catch
        {
            /* ignore */
        }

        return new MfeLaunch(beside, []);
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
                var path = Path.Combine(dir, "invocations.jsonl");
                var line = JsonSerializer.Serialize(new
                {
                    timestamp = DateTime.UtcNow.ToString("o"),
                    verb,
                    target,
                    action,
                    launcherVersion
                });
                File.AppendAllText(path, line + Environment.NewLine);
                TrimInvocations(path);
            }
            catch
            {
                // never block shell
            }
        }

        private static void TrimInvocations(string path)
        {
            try
            {
                var lines = File.ReadAllLines(path);
                if (lines.Length <= InvocationsMaxLines) return;
                File.WriteAllLines(path, lines.AsSpan(lines.Length - InvocationsMaxLines).ToArray());
            }
            catch
            {
                /* ignore */
            }
        }
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
