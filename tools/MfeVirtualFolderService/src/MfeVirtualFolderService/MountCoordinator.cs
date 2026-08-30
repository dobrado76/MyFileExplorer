using MfeVirtualFolder.Protocol;

namespace MfeVirtualFolderService;

public sealed class MountCoordinator
{
    readonly MountRegistry _registry;
    readonly IMountBackend _backend;
    readonly object _gate = new();

    public MountCoordinator(MountRegistry registry, IMountBackend backend)
    {
        _registry = registry;
        _backend = backend;
    }

    public IMountBackend Backend => _backend;

    public StatusPayload Status() => new()
    {
        WinFspAvailable = _backend.IsAvailable,
        HostMode = "per-user",
        MountCount = _backend.ActiveDocumentPaths.Count,
        Version = "0.1.0"
    };

    public MountInfo Mount(string documentPath)
    {
        documentPath = Path.GetFullPath(documentPath);
        if (!File.Exists(documentPath))
            throw new FileNotFoundException("Document not found", documentPath);
        if (!documentPath.EndsWith(VirtualFolderDocumentParser.Ext, StringComparison.OrdinalIgnoreCase))
            throw new InvalidOperationException("Path is not a .mfevirtual document");

        // Local path only (reject UNC / network shares — v1)
        if (documentPath.StartsWith(@"\\", StringComparison.Ordinal))
            throw new InvalidOperationException("Network paths are not supported for OS projection in v1");

        var mountPath = VirtualFolderDocumentParser.ProjectedMountPath(documentPath);
        if (Directory.Exists(mountPath) && !_backend.IsMounted(documentPath))
        {
            // Refuse non-empty real folders
            if (Directory.EnumerateFileSystemEntries(mountPath).Any())
                throw new InvalidOperationException(
                    $"Cannot project: folder “{mountPath}” already exists. Rename the Virtual Folder or the folder.");
        }

        lock (_gate)
        {
            _backend.Mount(documentPath, mountPath);
            var info = new MountInfo
            {
                DocumentPath = documentPath,
                MountPath = mountPath,
                Active = true
            };
            _registry.Upsert(info);
            return info;
        }
    }

    public void Unmount(string documentPath)
    {
        documentPath = Path.GetFullPath(documentPath);
        lock (_gate)
        {
            _backend.Unmount(documentPath);
            _registry.Remove(documentPath);
        }
    }

    public List<MountInfo> ListMounts()
    {
        var active = new HashSet<string>(_backend.ActiveDocumentPaths, StringComparer.OrdinalIgnoreCase);
        return _registry.All.Select(m =>
        {
            m.Active = active.Contains(m.DocumentPath);
            return m;
        }).ToList();
    }

    public void RemountRegistered()
    {
        foreach (var m in _registry.All.ToList())
        {
            try
            {
                if (!File.Exists(m.DocumentPath))
                {
                    _registry.Remove(m.DocumentPath);
                    continue;
                }
                if (_backend.IsMounted(m.DocumentPath)) continue;
                _backend.Mount(m.DocumentPath, m.MountPath);
                _registry.Upsert(new MountInfo
                {
                    DocumentPath = m.DocumentPath,
                    MountPath = m.MountPath,
                    Active = true
                });
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Remount failed for {m.DocumentPath}: {ex.Message}");
            }
        }
    }
}

public static class MountBackendFactory
{
    public static IMountBackend Create()
    {
#if HAS_WINFSP
        return new WinFspMountBackend();
#else
        return new UnavailableMountBackend(
            "WinFsp is not installed (or winfsp-msil.dll was not found when building). Install WinFsp from https://winfsp.dev/ and rebuild.");
#endif
    }
}
