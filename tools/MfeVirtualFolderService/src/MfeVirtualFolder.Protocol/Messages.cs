using System.Text.Json;
using System.Text.Json.Serialization;

namespace MfeVirtualFolder.Protocol;

/// <summary>Named-pipe protocol for MyFileExplorer ↔ Virtual Folder projection agent (D68).</summary>
public static class PipeNames
{
    public const string Default = @"\\.\pipe\MyFileExplorer.VirtualFolderService";
}

/// <summary>CamelCase JSON for one-line pipe request/response payloads.</summary>
public static class PipeJson
{
    public static readonly JsonSerializerOptions Options = new()
    {
        PropertyNamingPolicy = JsonNamingPolicy.CamelCase,
        PropertyNameCaseInsensitive = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };
}

public sealed class PipeRequest
{
    public string Cmd { get; set; } = "";
    public string? DocumentPath { get; set; }
    public string? Id { get; set; }
}

public sealed class PipeResponse
{
    public bool Ok { get; set; }
    public string? Error { get; set; }
    public string? Id { get; set; }
    public StatusPayload? Status { get; set; }
    public List<MountInfo>? Mounts { get; set; }
    public MountInfo? Mount { get; set; }
}

public sealed class StatusPayload
{
    public bool WinFspAvailable { get; set; }
    public string HostMode { get; set; } = "per-user";
    public int MountCount { get; set; }
    public string Version { get; set; } = "0.1.0";
}

public sealed class MountInfo
{
    public string DocumentPath { get; set; } = "";
    public string MountPath { get; set; } = "";
    public bool Active { get; set; }
}
