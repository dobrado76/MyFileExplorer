using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using Microsoft.Win32;

namespace MfeVirtualFolderService;

/// <summary>
/// Per-user autostart — survives reboot without a LocalSystem service.
/// WinFsp in-place mounts and the named pipe must run in the interactive user session.
/// Prefers a logon Scheduled Task; falls back to HKCU Run if Task Scheduler denies access.
/// </summary>
static class Autostart
{
    public const string TaskFolder = @"\MyFileExplorer\";
    public const string TaskName = "VirtualFolderProjection";
    public static string TaskPath => TaskFolder + TaskName;

    public const string RunValueName = "MyFileExplorerVirtualFolderProjection";

    public static int Install()
    {
        var exe = Environment.ProcessPath;
        if (string.IsNullOrWhiteSpace(exe) || !File.Exists(exe))
        {
            Console.Error.WriteLine("Cannot resolve this executable path.");
            return 1;
        }

        if (TryInstallScheduledTask(exe, out var taskError))
        {
            // Clear Run fallback if a prior install used it.
            TryRemoveRunKey();
            _ = TryStartScheduledTask();
            Console.WriteLine($"Registered logon task: {TaskPath}");
            Console.WriteLine($"Executable: {exe}");
            Console.WriteLine("Starts automatically when you sign in to Windows (and was started now).");
            return 0;
        }

        Console.WriteLine("Scheduled Task unavailable (" + Summarize(taskError) + "). Using Startup (Run) key instead.");
        if (!TryInstallRunKey(exe, out var runError))
        {
            Console.Error.WriteLine("Failed to register autostart: " + Summarize(runError));
            Console.Error.WriteLine("Run this from an unelevated PowerShell as your normal Windows user:");
            Console.Error.WriteLine($"  \"{exe}\" --install-autostart");
            return 1;
        }

        // Start immediately so reboot is not required for this session.
        try
        {
            Process.Start(new ProcessStartInfo
            {
                FileName = exe,
                UseShellExecute = false,
                CreateNoWindow = true
            });
        }
        catch (Exception ex)
        {
            Console.WriteLine("Registered, but could not start now: " + ex.Message);
        }

        Console.WriteLine($"Registered HKCU Run value: {RunValueName}");
        Console.WriteLine($"Executable: {exe}");
        Console.WriteLine("Starts automatically when you sign in to Windows.");
        return 0;
    }

    public static int Uninstall()
    {
        var removedTask = TryRemoveScheduledTask();
        var removedRun = TryRemoveRunKey();
        if (removedTask)
            Console.WriteLine($"Removed scheduled task: {TaskPath}");
        if (removedRun)
            Console.WriteLine($"Removed HKCU Run value: {RunValueName}");
        if (!removedTask && !removedRun)
            Console.WriteLine("Nothing to remove (autostart was not registered).");
        return 0;
    }

    static bool TryInstallScheduledTask(string exe, out string error)
    {
        var exeLit = exe.Replace("'", "''", StringComparison.Ordinal);
        var ps = $$"""
            $ErrorActionPreference = 'Stop'
            $exe = '{{exeLit}}'
            $taskName = '{{TaskName}}'
            $taskPath = '{{TaskFolder}}'

            try {
              $service = New-Object -ComObject Schedule.Service
              $service.Connect()
              $root = $service.GetFolder('\')
              try { $null = $root.GetFolder('MyFileExplorer') }
              catch { $null = $root.CreateFolder('MyFileExplorer') }
            } catch { }

            Unregister-ScheduledTask -TaskName $taskName -TaskPath $taskPath -Confirm:$false -ErrorAction SilentlyContinue

            $action = New-ScheduledTaskAction -Execute $exe
            $trigger = New-ScheduledTaskTrigger -AtLogOn
            $settings = New-ScheduledTaskSettingsSet `
              -AllowStartIfOnBatteries `
              -DontStopIfGoingOnBatteries `
              -StartWhenAvailable `
              -RestartCount 3 `
              -RestartInterval (New-TimeSpan -Minutes 1) `
              -ExecutionTimeLimit ([TimeSpan]::Zero) `
              -MultipleInstances IgnoreNew
            try { $settings.Hidden = $true } catch { }

            $principal = New-ScheduledTaskPrincipal `
              -UserId $env:USERNAME `
              -LogonType Interactive `
              -RunLevel Limited

            Register-ScheduledTask `
              -TaskName $taskName `
              -TaskPath $taskPath `
              -Action $action `
              -Trigger $trigger `
              -Settings $settings `
              -Principal $principal `
              -Force | Out-Null
            Write-Output 'OK'
            """;
        var code = RunPowerShell(ps, out _, out error);
        return code == 0;
    }

    static bool TryStartScheduledTask()
    {
        var ps = $$"""
            Start-ScheduledTask -TaskName '{{TaskName}}' -TaskPath '{{TaskFolder}}' -ErrorAction SilentlyContinue
            """;
        return RunPowerShell(ps, out _, out _) == 0;
    }

    static bool TryRemoveScheduledTask()
    {
        var ps = $$"""
            $ErrorActionPreference = 'Stop'
            Unregister-ScheduledTask -TaskName '{{TaskName}}' -TaskPath '{{TaskFolder}}' -Confirm:$false
            """;
        return RunPowerShell(ps, out _, out _) == 0;
    }

    static bool TryInstallRunKey(string exe, out string error)
    {
        try
        {
            using var key = Registry.CurrentUser.CreateSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run",
                writable: true);
            if (key is null)
            {
                error = "Could not open HKCU Run key";
                return false;
            }
            key.SetValue(RunValueName, "\"" + exe + "\"", RegistryValueKind.String);
            error = "";
            return true;
        }
        catch (Exception ex)
        {
            error = ex.Message;
            return false;
        }
    }

    static bool TryRemoveRunKey()
    {
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(
                @"Software\Microsoft\Windows\CurrentVersion\Run",
                writable: true);
            if (key is null) return false;
            if (key.GetValue(RunValueName) is null) return false;
            key.DeleteValue(RunValueName, throwOnMissingValue: false);
            return true;
        }
        catch
        {
            return false;
        }
    }

    static int RunPowerShell(string script, out string stdout, out string stderr)
    {
        var encoded = Convert.ToBase64String(Encoding.Unicode.GetBytes(script));
        var psi = new ProcessStartInfo
        {
            FileName = "powershell.exe",
            Arguments = "-NoProfile -ExecutionPolicy Bypass -EncodedCommand " + encoded,
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true
        };
        using var p = Process.Start(psi);
        if (p is null)
        {
            stdout = "";
            stderr = "Failed to start powershell.exe";
            return 1;
        }
        stdout = p.StandardOutput.ReadToEnd();
        stderr = p.StandardError.ReadToEnd();
        p.WaitForExit();
        return p.ExitCode;
    }

    static string Summarize(string? raw)
    {
        if (string.IsNullOrWhiteSpace(raw)) return "unknown error";
        var line = raw.Replace("\r", "", StringComparison.Ordinal)
            .Split('\n', StringSplitOptions.RemoveEmptyEntries)
            .Select(l => l.Trim())
            .FirstOrDefault(l => l.Length > 0 && !l.StartsWith("At ", StringComparison.Ordinal));
        return string.IsNullOrEmpty(line) ? raw.Trim() : line;
    }

    public static void EnsureConsole()
    {
        if (GetConsoleWindow() == IntPtr.Zero)
            AllocConsole();
    }

    [DllImport("kernel32.dll", SetLastError = true)]
    static extern bool AllocConsole();

    [DllImport("kernel32.dll")]
    static extern IntPtr GetConsoleWindow();
}
