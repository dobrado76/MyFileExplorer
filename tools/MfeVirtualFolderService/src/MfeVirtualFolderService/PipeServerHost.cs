using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using MfeVirtualFolder.Protocol;

namespace MfeVirtualFolderService;

public sealed class PipeServerHost : BackgroundService
{
    readonly MountCoordinator _coordinator;
    readonly ILogger<PipeServerHost> _log;

    public PipeServerHost(MountCoordinator coordinator, ILogger<PipeServerHost> log)
    {
        _coordinator = coordinator;
        _log = log;
    }

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _log.LogInformation("Named pipe listening on {Pipe}", PipeNames.Default);
        while (!stoppingToken.IsCancellationRequested)
        {
            var pipeName = PipeNames.Default.Replace(@"\\.\pipe\", "");
            var server = new NamedPipeServerStream(
                pipeName,
                PipeDirection.InOut,
                NamedPipeServerStream.MaxAllowedServerInstances,
                PipeTransmissionMode.Byte,
                PipeOptions.Asynchronous);

            try
            {
                await server.WaitForConnectionAsync(stoppingToken);
                _ = Task.Run(() => HandleClient(server, stoppingToken), stoppingToken);
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                await server.DisposeAsync();
                break;
            }
            catch (Exception ex)
            {
                _log.LogError(ex, "Pipe accept failed");
                await server.DisposeAsync();
                await Task.Delay(500, stoppingToken);
            }
        }
    }

    async Task HandleClient(NamedPipeServerStream server, CancellationToken ct)
    {
        await using (server)
        {
            try
            {
                using var reader = new StreamReader(server, Encoding.UTF8, leaveOpen: true);
                using var writer = new StreamWriter(server, Encoding.UTF8, leaveOpen: true) { AutoFlush = true };
                var line = await reader.ReadLineAsync(ct);
                if (string.IsNullOrWhiteSpace(line)) return;
                var req = JsonSerializer.Deserialize<PipeRequest>(line, PipeJson.Options) ?? new PipeRequest();
                var res = Dispatch(req);
                res.Id = req.Id;
                await writer.WriteLineAsync(JsonSerializer.Serialize(res, PipeJson.Options));
            }
            catch (Exception ex)
            {
                _log.LogWarning(ex, "Pipe client error");
            }
        }
    }

    PipeResponse Dispatch(PipeRequest req)
    {
        try
        {
            switch ((req.Cmd ?? "").Trim().ToLowerInvariant())
            {
                case "ping":
                    return new PipeResponse { Ok = true, Status = _coordinator.Status() };
                case "status":
                    return new PipeResponse { Ok = true, Status = _coordinator.Status() };
                case "listmounts":
                    return new PipeResponse { Ok = true, Mounts = _coordinator.ListMounts() };
                case "mount":
                    if (string.IsNullOrWhiteSpace(req.DocumentPath))
                        return Fail("documentPath required");
                    return new PipeResponse { Ok = true, Mount = _coordinator.Mount(req.DocumentPath) };
                case "unmount":
                    if (string.IsNullOrWhiteSpace(req.DocumentPath))
                        return Fail("documentPath required");
                    _coordinator.Unmount(req.DocumentPath);
                    return new PipeResponse { Ok = true };
                default:
                    return Fail($"Unknown command: {req.Cmd}");
            }
        }
        catch (Exception ex)
        {
            return Fail(ex.Message);
        }
    }

    static PipeResponse Fail(string error) => new() { Ok = false, Error = error };
}
