#if HAS_WINFSP
using System.Collections;
using System.Runtime.InteropServices;
using Fsp;
using MfeVirtualFolder.Protocol;
using FsFileInfo = Fsp.Interop.FileInfo;
using FsVolumeInfo = Fsp.Interop.VolumeInfo;

namespace MfeVirtualFolderService;

/// <summary>WinFsp-backed in-place projection of a .mfevirtual document (per-user agent).</summary>
public sealed class WinFspMountBackend : IMountBackend
{
    readonly object _gate = new();
    readonly Dictionary<string, ActiveMount> _active = new(StringComparer.OrdinalIgnoreCase);

    public bool IsAvailable => true;
    public string UnavailableReason => "";

    public IReadOnlyList<string> ActiveDocumentPaths
    {
        get { lock (_gate) return _active.Keys.ToList(); }
    }

    public bool IsMounted(string documentPath)
    {
        lock (_gate) return _active.ContainsKey(Norm(documentPath));
    }

    public void Mount(string documentPath, string mountPath)
    {
        documentPath = Norm(documentPath);
        mountPath = Norm(mountPath);
        if (!File.Exists(documentPath))
            throw new FileNotFoundException("Virtual Folder document not found", documentPath);
        if (documentPath.StartsWith(@"\\", StringComparison.Ordinal))
            throw new InvalidOperationException("UNC Virtual Folder documents are not supported in v1");

        lock (_gate)
        {
            if (_active.ContainsKey(documentPath))
                throw new InvalidOperationException("Already projected");

            var fs = new VirtualFolderFileSystem(documentPath);
            var host = new FileSystemHost(fs);
            host.FileSystemName = "MFEVirtualFolder";
            host.SectorSize = 4096;
            host.SectorsPerAllocationUnit = 1;
            host.MaxComponentLength = 255;
            host.CaseSensitiveSearch = false;
            host.CasePreservedNames = true;
            host.UnicodeOnDisk = true;
            host.PersistentAcls = false;
            host.PostCleanupWhenModifiedOnly = true;
            host.VolumeCreationTime = (ulong)DateTime.UtcNow.ToFileTimeUtc();
            host.VolumeSerialNumber = unchecked((uint)documentPath.GetHashCode());

            var status = host.Mount(mountPath);
            if (status < 0)
                throw new InvalidOperationException($"WinFsp Mount failed: 0x{unchecked((uint)status):X8}");

            _active[documentPath] = new ActiveMount(host, fs, mountPath);
            fs.StartWatching();
        }
    }

    public void Unmount(string documentPath)
    {
        documentPath = Norm(documentPath);
        ActiveMount? m;
        lock (_gate)
        {
            if (!_active.Remove(documentPath, out m) || m is null) return;
        }
        try
        {
            m.Fs.StopWatching();
            m.Host.Unmount();
            m.Host.Dispose();
        }
        catch
        {
            /* best-effort */
        }
    }

    static string Norm(string p) => Path.GetFullPath(p);

    sealed record ActiveMount(FileSystemHost Host, VirtualFolderFileSystem Fs, string MountPath);
}

sealed class VirtualFolderFileSystem : FileSystemBase
{
    readonly string _documentPath;
    readonly object _gate = new();
    VirtualFolderDocument _doc;
    FileSystemWatcher? _watcher;
    Dictionary<string, RootMember> _root = new(StringComparer.OrdinalIgnoreCase);

    public VirtualFolderFileSystem(string documentPath)
    {
        _documentPath = documentPath;
        _doc = VirtualFolderDocumentParser.LoadFile(documentPath);
        RebuildRoot();
    }

    public void StartWatching()
    {
        var dir = Path.GetDirectoryName(_documentPath)!;
        _watcher = new FileSystemWatcher(dir, Path.GetFileName(_documentPath))
        {
            NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.Size | NotifyFilters.FileName
        };
        void reload(object? _, FileSystemEventArgs __) => ReloadSafe();
        _watcher.Changed += reload;
        _watcher.Created += reload;
        _watcher.Deleted += reload;
        _watcher.Renamed += (_, _) => ReloadSafe();
        _watcher.EnableRaisingEvents = true;
    }

    public void StopWatching()
    {
        _watcher?.Dispose();
        _watcher = null;
    }

    void ReloadSafe()
    {
        try
        {
            Thread.Sleep(40);
            lock (_gate)
            {
                _doc = VirtualFolderDocumentParser.LoadFile(_documentPath);
                RebuildRoot();
            }
        }
        catch { /* keep previous */ }
    }

    void RebuildRoot()
    {
        _root = BuildMemberMap(_documentPath, _doc.Entries);
    }

    Dictionary<string, RootMember> BuildMemberMap(string documentPath, List<VirtualFolderEntry> entries)
    {
        var map = new Dictionary<string, RootMember>(StringComparer.OrdinalIgnoreCase);
        var used = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var entry in entries)
        {
            var resolved = VirtualFolderDocumentParser.ResolveEntryPath(documentPath, entry);
            var display = VirtualFolderDocumentParser.EntryDisplayName(entry, Path.GetFileName(resolved));
            display = Uniquify(display, used);
            used.Add(display);
            if (VirtualFolderDocumentParser.IsEmbeddedGroup(entry))
            {
                map[display] = RootMember.Embedded(entry.Id, entry.Children ?? new List<VirtualFolderEntry>());
            }
            else
            {
                map[display] = RootMember.Link(entry.Id, entry.Kind, resolved);
            }
        }
        return map;
    }

    static string Uniquify(string name, HashSet<string> used)
    {
        if (!used.Contains(name)) return name;
        for (var i = 2; i < 10_000; i++)
        {
            var n = $"{name} ({i})";
            if (!used.Contains(n)) return n;
        }
        return name + "-" + Guid.NewGuid().ToString("N")[..8];
    }

    public override int GetVolumeInfo(out FsVolumeInfo volumeInfo)
    {
        volumeInfo = default;
        volumeInfo.TotalSize = 1UL << 40;
        volumeInfo.FreeSize = 1UL << 39;
        volumeInfo.SetVolumeLabel("MFE Virtual Folder");
        return STATUS_SUCCESS;
    }

    public override int GetSecurityByName(string fileName, out uint fileAttributes, ref byte[] securityDescriptor)
    {
        fileAttributes = 0;
        if (!TryStat(fileName, out var st))
            return STATUS_OBJECT_NAME_NOT_FOUND;
        fileAttributes = st.Attributes;
        return STATUS_SUCCESS;
    }

    public override int Open(
        string fileName,
        uint createOptions,
        uint grantedAccess,
        out object fileNode,
        out object fileDesc,
        out FsFileInfo fileInfo,
        out string normalizedName)
    {
        fileNode = null!;
        fileDesc = null!;
        fileInfo = default;
        normalizedName = fileName;
        if (!TryStat(fileName, out var st))
            return STATUS_OBJECT_NAME_NOT_FOUND;

        FileStream? stream = null;
        if (!st.IsDirectory)
        {
            try
            {
                stream = new FileStream(st.FullPath, FileMode.Open, FileAccess.ReadWrite,
                    FileShare.ReadWrite | FileShare.Delete);
            }
            catch (FileNotFoundException)
            {
                return STATUS_OBJECT_NAME_NOT_FOUND;
            }
            catch
            {
                return STATUS_ACCESS_DENIED;
            }
        }

        var opened = new Opened(st, stream);
        fileNode = opened;
        fileDesc = opened;
        fileInfo = st.ToFileInfo();
        return STATUS_SUCCESS;
    }

    public override void Close(object fileNode, object fileDesc)
    {
        if (fileDesc is Opened o)
            o.Stream?.Dispose();
    }

    public override int Read(
        object fileNode,
        object fileDesc,
        IntPtr buffer,
        ulong offset,
        uint length,
        out uint bytesTransferred)
    {
        bytesTransferred = 0;
        if (fileDesc is not Opened { Stream: { } stream })
            return STATUS_INVALID_DEVICE_REQUEST;
        var buf = new byte[length];
        stream.Position = (long)offset;
        var n = stream.Read(buf, 0, (int)length);
        bytesTransferred = (uint)n;
        if (n > 0) Marshal.Copy(buf, 0, buffer, n);
        return STATUS_SUCCESS;
    }

    public override int Write(
        object fileNode,
        object fileDesc,
        IntPtr buffer,
        ulong offset,
        uint length,
        bool writeToEndOfFile,
        bool constrainedIo,
        out uint bytesTransferred,
        out FsFileInfo fileInfo)
    {
        bytesTransferred = 0;
        fileInfo = default;
        if (fileDesc is not Opened { Stream: { } stream } opened)
            return STATUS_ACCESS_DENIED;
        var buf = new byte[length];
        Marshal.Copy(buffer, buf, 0, (int)length);
        stream.Position = writeToEndOfFile ? stream.Length : (long)offset;
        stream.Write(buf, 0, (int)length);
        bytesTransferred = length;
        fileInfo = opened.Stat.ToFileInfo();
        return STATUS_SUCCESS;
    }

    /// <summary>
    /// WinFsp .NET fills directories via ReadDirectoryEntry (base ReadDirectory → SeekableReadDirectory).
    /// DirInfo / DirectoryBuffer are internal — do not use them from providers.
    /// v1: no short-lived enum cache; rebuild from JSON / real readdir each pass.
    /// </summary>
    public override bool ReadDirectoryEntry(
        object fileNode,
        object fileDesc,
        string? pattern,
        string? marker,
        ref object? context,
        out string fileName,
        out FsFileInfo fileInfo)
    {
        fileName = "";
        fileInfo = default;
        if (fileDesc is not Opened opened)
            return false;

        if (context is not IEnumerator<NameStat> enumerator)
        {
            IEnumerable<NameStat> entries = Enumerate(opened.Stat);
            if (!string.IsNullOrEmpty(pattern) && pattern is not ("*" or "*.*"))
                entries = entries.Where(e => Match(pattern!, e.Name));

            var list = entries.OrderBy(x => x.Name, StringComparer.OrdinalIgnoreCase).ToList();

            // SeekableReadDirectory: when Marker is set, skip until after that name.
            if (!string.IsNullOrEmpty(marker))
            {
                var idx = list.FindIndex(e =>
                    string.Equals(e.Name, marker, StringComparison.OrdinalIgnoreCase));
                if (idx >= 0)
                    list = list.Skip(idx + 1).ToList();
            }

            enumerator = list.GetEnumerator();
            context = enumerator;
        }

        while (enumerator.MoveNext())
        {
            var cur = enumerator.Current;
            fileName = cur.Name;
            fileInfo = cur.Stat.ToFileInfo();
            return true;
        }

        return false;
    }

    public override int CanDelete(object fileNode, object fileDesc, string fileName) => STATUS_SUCCESS;

    public override int SetDelete(object fileNode, object fileDesc, string fileName, bool disposition)
    {
        if (!disposition) return STATUS_SUCCESS;
        var parts = Split(fileName);
        if (parts.Length == 1)
        {
            lock (_gate)
            {
                if (!_root.TryGetValue(parts[0], out var member))
                    return STATUS_OBJECT_NAME_NOT_FOUND;
                _doc.Entries.RemoveAll(e => e.Id == member.EntryId);
                VirtualFolderDocumentParser.SaveFile(_documentPath, _doc);
                RebuildRoot();
            }
            return STATUS_SUCCESS;
        }
        if (!TryStat(fileName, out var st))
            return STATUS_OBJECT_NAME_NOT_FOUND;
        try
        {
            if (st.IsDirectory) Directory.Delete(st.FullPath, true);
            else File.Delete(st.FullPath);
            return STATUS_SUCCESS;
        }
        catch
        {
            return STATUS_ACCESS_DENIED;
        }
    }

    public override int Create(
        string fileName,
        uint createOptions,
        uint grantedAccess,
        uint fileAttributes,
        byte[] securityDescriptor,
        ulong allocationSize,
        out object fileNode,
        out object fileDesc,
        out FsFileInfo fileInfo,
        out string normalizedName)
    {
        fileNode = null!;
        fileDesc = null!;
        fileInfo = default;
        normalizedName = fileName;
        return STATUS_ACCESS_DENIED;
    }

    IEnumerable<NameStat> Enumerate(PathStat parent)
    {
        if (parent.IsVirtualRoot)
        {
            lock (_gate)
            {
                foreach (var kv in _root)
                    yield return new NameStat(kv.Key, StatForMember(kv.Value));
            }
            yield break;
        }

        if (parent.Kind == "virtualFolder")
        {
            if (parent.EmbeddedChildren != null)
            {
                foreach (var kv in BuildMemberMap(_documentPath, parent.EmbeddedChildren))
                    yield return new NameStat(kv.Key, StatForMember(kv.Value));
                yield break;
            }
            // Legacy nested .mfevirtual: in-process listing (no second mount). Cycles → empty via visited-set.
            foreach (var kv in LoadNestedRoot(parent.FullPath, new HashSet<string>(StringComparer.OrdinalIgnoreCase) { _documentPath }))
                yield return new NameStat(kv.Key, StatForMember(kv.Value));
            yield break;
        }

        if (!Directory.Exists(parent.FullPath)) yield break;
        foreach (var path in Directory.EnumerateFileSystemEntries(parent.FullPath))
        {
            var name = Path.GetFileName(path);
            yield return new NameStat(name, StatReal(path));
        }
    }

    /// <summary>
    /// Resolve a path under a nested Virtual Folder document.
    /// <paramref name="visited"/> prevents cycles (A→B→A) from infinite recursion when walking.
    /// </summary>
    bool TryStatUnderVirtual(string nestedDoc, string[] rest, HashSet<string> visited, out PathStat st)
    {
        st = default!;
        nestedDoc = Path.GetFullPath(nestedDoc);
        var nested = LoadNestedRoot(nestedDoc, visited);
        if (rest.Length == 0)
        {
            st = new PathStat(nestedDoc, true, "virtualFolder", (uint)FileAttributes.Directory, 0, TimesOf(nestedDoc));
            return true;
        }
        if (!nested.TryGetValue(rest[0], out var child)) return false;
        if (rest.Length == 1)
        {
            st = StatForMember(child);
            return true;
        }
        if (child.Kind == "virtualFolder")
            return TryStatUnderVirtual(child.ResolvedPath, rest.Skip(1).ToArray(), visited, out st);
        if (child.Kind != "folder") return false;
        var full = Path.Combine(new[] { child.ResolvedPath }.Concat(rest.Skip(1)).ToArray());
        if (!File.Exists(full) && !Directory.Exists(full)) return false;
        st = StatReal(full);
        return true;
    }

    /// <summary>
    /// Load members of a nested Virtual Folder document.
    /// Returns empty when <paramref name="nestedDoc"/> is already in <paramref name="visited"/> (cycle).
    /// </summary>
    Dictionary<string, RootMember> LoadNestedRoot(string nestedDoc, HashSet<string> visited)
    {
        nestedDoc = Path.GetFullPath(nestedDoc);
        if (!visited.Add(nestedDoc))
            return new Dictionary<string, RootMember>(StringComparer.OrdinalIgnoreCase);
        try
        {
            var doc = VirtualFolderDocumentParser.LoadFile(nestedDoc);
            return BuildMemberMap(nestedDoc, doc.Entries);
        }
        catch
        {
            return new Dictionary<string, RootMember>(StringComparer.OrdinalIgnoreCase);
        }
    }

    bool TryStat(string fileName, out PathStat st)
    {
        st = default!;
        var parts = Split(fileName);
        if (parts.Length == 0)
        {
            st = PathStat.VirtualRoot(_documentPath);
            return true;
        }

        lock (_gate)
        {
            if (!_root.TryGetValue(parts[0], out var member))
                return false;

            if (parts.Length == 1)
            {
                st = StatForMember(member);
                return true;
            }

            if (member.Kind == "file") return false;

            if (member.Kind == "virtualFolder")
            {
                if (member.IsEmbedded)
                {
                    return TryStatUnderEmbedded(member.EmbeddedChildren!, parts.Skip(1).ToArray(), out st);
                }
                var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { _documentPath };
                return TryStatUnderVirtual(member.ResolvedPath, parts.Skip(1).ToArray(), visited, out st);
            }

            var real = Path.Combine(new[] { member.ResolvedPath }.Concat(parts.Skip(1)).ToArray());
            if (!File.Exists(real) && !Directory.Exists(real)) return false;
            st = StatReal(real);
            return true;
        }
    }

    bool TryStatUnderEmbedded(List<VirtualFolderEntry> children, string[] rest, out PathStat st)
    {
        st = default!;
        var map = BuildMemberMap(_documentPath, children);
        if (rest.Length == 0)
        {
            st = new PathStat("", true, "virtualFolder", (uint)FileAttributes.Directory, 0, default, children);
            return true;
        }
        if (!map.TryGetValue(rest[0], out var child)) return false;
        if (rest.Length == 1)
        {
            st = StatForMember(child);
            return true;
        }
        if (child.IsEmbedded)
            return TryStatUnderEmbedded(child.EmbeddedChildren!, rest.Skip(1).ToArray(), out st);
        if (child.Kind == "virtualFolder")
        {
            var visited = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { _documentPath };
            return TryStatUnderVirtual(child.ResolvedPath, rest.Skip(1).ToArray(), visited, out st);
        }
        if (child.Kind != "folder") return false;
        var full = Path.Combine(new[] { child.ResolvedPath }.Concat(rest.Skip(1)).ToArray());
        if (!File.Exists(full) && !Directory.Exists(full)) return false;
        st = StatReal(full);
        return true;
    }

    static PathStat StatForMember(RootMember m)
    {
        var isDir = m.Kind is "folder" or "virtualFolder";
        if (m.IsEmbedded)
            return new PathStat("", true, "virtualFolder", (uint)FileAttributes.Directory, 0, default, m.EmbeddedChildren);
        if (m.Kind == "virtualFolder")
            return new PathStat(m.ResolvedPath, true, "virtualFolder", (uint)FileAttributes.Directory, 0, TimesOf(m.ResolvedPath));
        if (isDir && Directory.Exists(m.ResolvedPath))
            return StatReal(m.ResolvedPath);
        if (!isDir && File.Exists(m.ResolvedPath))
            return StatReal(m.ResolvedPath);
        // Missing target: still list; open will fail
        return new PathStat(m.ResolvedPath, isDir, m.Kind,
            isDir ? (uint)FileAttributes.Directory : (uint)FileAttributes.Normal, 0, default);
    }

    static PathStat StatReal(string path)
    {
        var isDir = Directory.Exists(path);
        ulong size = 0;
        uint attr = isDir ? (uint)FileAttributes.Directory : (uint)FileAttributes.Normal;
        try
        {
            attr = (uint)File.GetAttributes(path);
            if (!isDir)
                size = (ulong)new System.IO.FileInfo(path).Length;
        }
        catch { }
        return new PathStat(path, isDir, isDir ? "folder" : "file", attr, size, TimesOf(path));
    }

    static (ulong C, ulong A, ulong M) TimesOf(string path)
    {
        try
        {
            if (Directory.Exists(path))
            {
                var d = new DirectoryInfo(path);
                return (
                    (ulong)d.CreationTimeUtc.ToFileTimeUtc(),
                    (ulong)d.LastAccessTimeUtc.ToFileTimeUtc(),
                    (ulong)d.LastWriteTimeUtc.ToFileTimeUtc());
            }
            if (File.Exists(path))
            {
                var f = new System.IO.FileInfo(path);
                return (
                    (ulong)f.CreationTimeUtc.ToFileTimeUtc(),
                    (ulong)f.LastAccessTimeUtc.ToFileTimeUtc(),
                    (ulong)f.LastWriteTimeUtc.ToFileTimeUtc());
            }
        }
        catch { }
        return default;
    }

    static string[] Split(string fileName)
    {
        fileName = (fileName ?? "").Replace('/', '\\').Trim('\\');
        if (fileName.Length == 0) return Array.Empty<string>();
        return fileName.Split('\\', StringSplitOptions.RemoveEmptyEntries);
    }

    static bool Match(string pattern, string name) =>
        name.Contains(pattern.Trim('*'), StringComparison.OrdinalIgnoreCase);

    sealed class Opened
    {
        public Opened(PathStat st, FileStream? stream)
        {
            Stat = st;
            Stream = stream;
        }
        public PathStat Stat { get; }
        public FileStream? Stream { get; }
    }

    sealed class RootMember
    {
        RootMember(string entryId, string kind, string resolvedPath, List<VirtualFolderEntry>? embeddedChildren)
        {
            EntryId = entryId;
            Kind = kind;
            ResolvedPath = resolvedPath;
            EmbeddedChildren = embeddedChildren;
        }

        public static RootMember Link(string entryId, string kind, string resolvedPath) =>
            new(entryId, kind, resolvedPath, null);

        public static RootMember Embedded(string entryId, List<VirtualFolderEntry> children) =>
            new(entryId, "virtualFolder", "", children);

        public string EntryId { get; }
        public string Kind { get; }
        public string ResolvedPath { get; }
        public List<VirtualFolderEntry>? EmbeddedChildren { get; }
        public bool IsEmbedded => EmbeddedChildren != null;
    }

    readonly record struct NameStat(string Name, PathStat Stat);

    sealed class PathStat
    {
        public PathStat(
            string fullPath,
            bool isDirectory,
            string kind,
            uint attributes,
            ulong size,
            (ulong C, ulong A, ulong M) times,
            List<VirtualFolderEntry>? embeddedChildren = null)
        {
            FullPath = fullPath;
            IsDirectory = isDirectory;
            Kind = kind;
            Attributes = attributes;
            Size = size;
            Ctime = times.C;
            Atime = times.A;
            Mtime = times.M;
            IsVirtualRoot = kind == "root";
            EmbeddedChildren = embeddedChildren;
        }

        public static PathStat VirtualRoot(string documentPath) =>
            new(documentPath, true, "root", (uint)FileAttributes.Directory, 0, default);

        public string FullPath { get; }
        public bool IsDirectory { get; }
        public string Kind { get; }
        public uint Attributes { get; }
        public ulong Size { get; }
        public ulong Ctime { get; }
        public ulong Atime { get; }
        public ulong Mtime { get; }
        public bool IsVirtualRoot { get; }
        public List<VirtualFolderEntry>? EmbeddedChildren { get; }

        public FsFileInfo ToFileInfo()
        {
            var fi = default(FsFileInfo);
            fi.FileAttributes = Attributes;
            fi.FileSize = Size;
            fi.AllocationSize = Size;
            fi.CreationTime = Ctime;
            fi.LastAccessTime = Atime;
            fi.LastWriteTime = Mtime;
            fi.ChangeTime = Mtime;
            return fi;
        }
    }
}
#endif
