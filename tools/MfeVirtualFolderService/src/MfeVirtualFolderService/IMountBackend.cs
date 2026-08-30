namespace MfeVirtualFolderService;

public interface IMountBackend
{
    bool IsAvailable { get; }
    string UnavailableReason { get; }
    /// <summary>Start projecting documentPath at its in-place sibling mount directory.</summary>
    void Mount(string documentPath, string mountPath);
    void Unmount(string documentPath);
    bool IsMounted(string documentPath);
    IReadOnlyList<string> ActiveDocumentPaths { get; }
}

/// <summary>Used when WinFsp is not installed / not referenced at build time.</summary>
public sealed class UnavailableMountBackend : IMountBackend
{
    public bool IsAvailable => false;
    public string UnavailableReason { get; }

    public UnavailableMountBackend(string reason)
    {
        UnavailableReason = reason;
    }

    public void Mount(string documentPath, string mountPath) =>
        throw new InvalidOperationException(UnavailableReason);

    public void Unmount(string documentPath) { }

    public bool IsMounted(string documentPath) => false;

    public IReadOnlyList<string> ActiveDocumentPaths => Array.Empty<string>();
}
