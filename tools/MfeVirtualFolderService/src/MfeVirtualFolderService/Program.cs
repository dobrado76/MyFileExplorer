using System.Reflection;
using MfeVirtualFolderService;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Hosting;

// WinFsp is installed machine-wide; we reference winfsp-msil without copying it
// (license). Resolve from the WinFsp bin directory at runtime.
WinFspAssemblyResolve.Register();

if (args.Any(a => string.Equals(a, "--install-autostart", StringComparison.OrdinalIgnoreCase)))
{
    Autostart.EnsureConsole();
    Environment.Exit(Autostart.Install());
}

if (args.Any(a => string.Equals(a, "--uninstall-autostart", StringComparison.OrdinalIgnoreCase)))
{
    Autostart.EnsureConsole();
    Environment.Exit(Autostart.Uninstall());
}

var console = args.Any(a => string.Equals(a, "--console", StringComparison.OrdinalIgnoreCase));
if (console)
    Autostart.EnsureConsole();

var builder = Host.CreateApplicationBuilder(args);
builder.Services.AddSingleton<MountRegistry>();
builder.Services.AddSingleton<IMountBackend>(_ => MountBackendFactory.Create());
builder.Services.AddSingleton<MountCoordinator>();
builder.Services.AddHostedService<PipeServerHost>();
builder.Services.AddHostedService<RemountHostedService>();

// SCM Windows Service is optional/advanced; default “setup once” is a per-user logon task
// (--install-autostart). AddWindowsService still lets `sc create` work if someone prefers it.
if (!console)
    builder.Services.AddWindowsService(o => o.ServiceName = "MyFileExplorer Virtual Folder Projection");

var host = builder.Build();
if (console)
{
    Console.WriteLine(
        $"MfeVirtualFolderService starting (console={console}, WinFsp={host.Services.GetRequiredService<IMountBackend>().IsAvailable})");
}
await host.RunAsync();

sealed class RemountHostedService : IHostedService
{
    readonly MountCoordinator _coordinator;
    public RemountHostedService(MountCoordinator coordinator) => _coordinator = coordinator;
    public Task StartAsync(CancellationToken cancellationToken)
    {
        if (_coordinator.Backend.IsAvailable)
            _coordinator.RemountRegistered();
        return Task.CompletedTask;
    }
    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;
}

/// <summary>Load winfsp-msil from the WinFsp install (or next to this exe if present).</summary>
static class WinFspAssemblyResolve
{
    static readonly string[] ProbeDirs =
    [
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFilesX86), "WinFsp", "bin"),
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "WinFsp", "bin"),
        AppContext.BaseDirectory
    ];

    public static void Register()
    {
        // Native winfsp-*.dll lives beside winfsp-msil in the WinFsp bin folder.
        foreach (var dir in ProbeDirs)
        {
            if (!Directory.Exists(dir)) continue;
            var path = Environment.GetEnvironmentVariable("PATH") ?? "";
            if (path.Split(Path.PathSeparator, StringSplitOptions.RemoveEmptyEntries)
                .Any(p => string.Equals(p, dir, StringComparison.OrdinalIgnoreCase)))
                break;
            Environment.SetEnvironmentVariable("PATH", dir + Path.PathSeparator + path);
            break;
        }

        AppDomain.CurrentDomain.AssemblyResolve += (_, args) => TryLoad(args.Name);

        System.Runtime.Loader.AssemblyLoadContext.Default.Resolving += (_, name) =>
        {
            if (!string.Equals(name.Name, "winfsp-msil", StringComparison.OrdinalIgnoreCase))
                return null;
            return TryLoadFromProbeDirs();
        };
    }

    static Assembly? TryLoad(string? fullName)
    {
        if (string.IsNullOrEmpty(fullName)) return null;
        AssemblyName name;
        try
        {
            name = new AssemblyName(fullName);
        }
        catch
        {
            return null;
        }
        if (!string.Equals(name.Name, "winfsp-msil", StringComparison.OrdinalIgnoreCase))
            return null;
        return TryLoadFromProbeDirs();
    }

    static Assembly? TryLoadFromProbeDirs()
    {
        foreach (var dir in ProbeDirs)
        {
            var dll = Path.Combine(dir, "winfsp-msil.dll");
            if (File.Exists(dll))
                return Assembly.LoadFrom(dll);
        }
        return null;
    }
}
