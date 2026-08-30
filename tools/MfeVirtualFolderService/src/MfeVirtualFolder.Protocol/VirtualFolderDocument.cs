using System.Text.Json;
using System.Text.Json.Serialization;

namespace MfeVirtualFolder.Protocol;

public sealed class VirtualFolderDocument
{
    public string Format { get; set; } = "";
    public int Version { get; set; }
    public string Id { get; set; } = "";
    public string? Created { get; set; }
    public string? Modified { get; set; }
    public VirtualFolderSettings? Settings { get; set; }
    public List<VirtualFolderEntry> Entries { get; set; } = new();
}

public sealed class VirtualFolderSettings
{
    public bool? ManualOrder { get; set; }
}

public sealed class VirtualFolderEntry
{
    public string Id { get; set; } = "";
    public string Kind { get; set; } = "file";
    public string? Path { get; set; }
    public bool? Relative { get; set; }
    public string? Label { get; set; }
    public string? Note { get; set; }
    public List<VirtualFolderEntry>? Children { get; set; }
}

public static class VirtualFolderDocumentParser
{
    public const string Format = "MyFileExplorer.VirtualFolder";
    public const int Version = 1;
    public const string Ext = ".mfevirtual";

    static readonly JsonSerializerOptions JsonOpts = new()
    {
        PropertyNameCaseInsensitive = true,
        ReadCommentHandling = JsonCommentHandling.Skip,
        AllowTrailingCommas = true,
        DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
    };

    public static VirtualFolderDocument Parse(string json)
    {
        var doc = JsonSerializer.Deserialize<VirtualFolderDocument>(json, JsonOpts)
            ?? throw new InvalidDataException("Document must be a JSON object");
        if (!string.Equals(doc.Format, Format, StringComparison.Ordinal))
            throw new InvalidDataException($"Unsupported format (expected {Format})");
        if (doc.Version != Version)
            throw new InvalidDataException($"Unsupported Virtual Folder version {doc.Version}");
        if (string.IsNullOrWhiteSpace(doc.Id))
            throw new InvalidDataException("Document id is required");
        doc.Entries ??= new List<VirtualFolderEntry>();
        doc.Entries = NormalizeEntries(doc.Entries);
        return doc;
    }

    static List<VirtualFolderEntry> NormalizeEntries(List<VirtualFolderEntry>? raw)
    {
        var list = new List<VirtualFolderEntry>();
        if (raw == null) return list;
        foreach (var e in raw)
        {
            if (e == null || string.IsNullOrWhiteSpace(e.Id)) continue;
            e.Kind = NormalizeKind(e.Kind);
            var path = (e.Path ?? "").Trim();
            if (e.Kind == "virtualFolder")
            {
                if (path.Length == 0)
                {
                    // Embedded group
                    e.Path = null;
                    e.Label = string.IsNullOrWhiteSpace(e.Label) ? "Virtual Folder" : e.Label.Trim();
                    e.Children = NormalizeEntries(e.Children ?? new List<VirtualFolderEntry>());
                    list.Add(e);
                    continue;
                }
                // Legacy external link — drop children
                e.Path = path;
                e.Children = null;
                list.Add(e);
                continue;
            }
            if (path.Length == 0) continue;
            e.Path = path;
            e.Children = null;
            list.Add(e);
        }
        return list;
    }

    public static bool IsEmbeddedGroup(VirtualFolderEntry entry) =>
        string.Equals(entry.Kind, "virtualFolder", StringComparison.Ordinal) &&
        string.IsNullOrWhiteSpace(entry.Path);

    public static VirtualFolderDocument LoadFile(string path)
    {
        var text = File.ReadAllText(path);
        return Parse(text);
    }

    public static void SaveFile(string path, VirtualFolderDocument doc)
    {
        doc.Modified = DateTime.UtcNow.ToString("o");
        var json = JsonSerializer.Serialize(doc, new JsonSerializerOptions
        {
            WriteIndented = true,
            PropertyNamingPolicy = null,
            DefaultIgnoreCondition = JsonIgnoreCondition.WhenWritingNull
        });
        var tmp = path + ".tmp";
        File.WriteAllText(tmp, json.Replace("\r\n", "\n") + (json.EndsWith('\n') ? "" : "\n"));
        File.Copy(tmp, path, overwrite: true);
        File.Delete(tmp);
    }

    public static string DocumentDir(string documentPath)
    {
        var dir = Path.GetDirectoryName(documentPath);
        if (string.IsNullOrEmpty(dir)) return documentPath;
        return dir;
    }

    public static string StemFromFileName(string fileName)
    {
        var baseName = Path.GetFileName(fileName);
        if (baseName.EndsWith(Ext, StringComparison.OrdinalIgnoreCase))
            return baseName[..^Ext.Length];
        return baseName;
    }

    public static string ProjectedMountPath(string documentPath)
    {
        var dir = DocumentDir(documentPath);
        var stem = StemFromFileName(documentPath);
        return Path.Combine(dir, stem);
    }

    public static string ResolveEntryPath(string documentPath, VirtualFolderEntry entry)
    {
        var raw = (entry.Path ?? "").Trim();
        if (raw.Length == 0) return "";
        if (entry.Relative == true)
        {
            var baseDir = DocumentDir(documentPath);
            var parts = raw.Replace('\\', '/').Split('/', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries);
            var cur = baseDir;
            foreach (var part in parts)
            {
                if (part == ".") continue;
                if (part == "..")
                {
                    cur = Path.GetDirectoryName(cur) ?? cur;
                    continue;
                }
                cur = Path.Combine(cur, part);
            }
            return cur;
        }
        return raw;
    }

    public static string EntryDisplayName(VirtualFolderEntry entry, string? resolvedBasename = null)
    {
        if (!string.IsNullOrWhiteSpace(entry.Label)) return entry.Label.Trim();
        if (!string.IsNullOrWhiteSpace(resolvedBasename)) return resolvedBasename!;
        var p = (entry.Path ?? "").Replace('\\', '/');
        if (p.Length == 0) return "Virtual Folder";
        var i = p.LastIndexOf('/');
        return i >= 0 ? p[(i + 1)..] : p;
    }

    static string NormalizeKind(string? kind) =>
        kind switch
        {
            "folder" => "folder",
            "virtualFolder" => "virtualFolder",
            _ => "file"
        };
}
