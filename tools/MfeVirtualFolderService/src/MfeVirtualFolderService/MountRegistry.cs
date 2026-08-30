using System.Text.Json;
using MfeVirtualFolder.Protocol;

namespace MfeVirtualFolderService;

public sealed class MountRegistry
{
    readonly string _path;
    readonly object _gate = new();
    List<MountInfo> _mounts = new();

    public MountRegistry(string? path = null)
    {
        var root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "MyFileExplorer",
            "VirtualFolderService");
        Directory.CreateDirectory(root);
        _path = path ?? Path.Combine(root, "mounts.json");
        Load();
    }

    public IReadOnlyList<MountInfo> All
    {
        get { lock (_gate) return _mounts.Select(Clone).ToList(); }
    }

    public void Upsert(MountInfo info)
    {
        lock (_gate)
        {
            _mounts.RemoveAll(m => PathsEqual(m.DocumentPath, info.DocumentPath));
            _mounts.Add(Clone(info));
            Save();
        }
    }

    public bool Remove(string documentPath)
    {
        lock (_gate)
        {
            var n = _mounts.RemoveAll(m => PathsEqual(m.DocumentPath, documentPath));
            if (n > 0) Save();
            return n > 0;
        }
    }

    public MountInfo? Find(string documentPath)
    {
        lock (_gate)
            return _mounts.Select(Clone).FirstOrDefault(m => PathsEqual(m.DocumentPath, documentPath));
    }

    void Load()
    {
        if (!File.Exists(_path)) return;
        try
        {
            var json = File.ReadAllText(_path);
            var list = JsonSerializer.Deserialize<List<MountInfo>>(json);
            if (list != null) _mounts = list;
        }
        catch
        {
            _mounts = new List<MountInfo>();
        }
    }

    void Save()
    {
        var json = JsonSerializer.Serialize(_mounts, new JsonSerializerOptions { WriteIndented = true });
        var tmp = _path + ".tmp";
        File.WriteAllText(tmp, json);
        File.Copy(tmp, _path, overwrite: true);
        File.Delete(tmp);
    }

    static MountInfo Clone(MountInfo m) => new()
    {
        DocumentPath = m.DocumentPath,
        MountPath = m.MountPath,
        Active = m.Active
    };

    static bool PathsEqual(string a, string b) =>
        string.Equals(a.TrimEnd('\\', '/'), b.TrimEnd('\\', '/'), StringComparison.OrdinalIgnoreCase);
}
