using MfeVirtualFolder.Protocol;
using Xunit;

namespace MfeVirtualFolder.Protocol.Tests;

public class DocumentParserTests
{
    [Fact]
    public void Parses_empty_golden_fixture()
    {
        var path = FindFixture("empty.mfevirtual.json");
        var doc = VirtualFolderDocumentParser.LoadFile(path);
        Assert.Equal(VirtualFolderDocumentParser.Format, doc.Format);
        Assert.Empty(doc.Entries);
    }

    [Fact]
    public void Parses_mixed_golden_fixture_with_embedded_group()
    {
        var path = FindFixture("mixed-entries.mfevirtual.json");
        var doc = VirtualFolderDocumentParser.LoadFile(path);
        Assert.Equal(4, doc.Entries.Count);
        Assert.Equal("file", doc.Entries[0].Kind);
        Assert.Equal("folder", doc.Entries[1].Kind);
        Assert.Equal("virtualFolder", doc.Entries[2].Kind);
        Assert.True(VirtualFolderDocumentParser.IsEmbeddedGroup(doc.Entries[2]));
        Assert.Equal("Nested group", doc.Entries[2].Label);
        Assert.Single(doc.Entries[2].Children!);
        Assert.Equal("virtualFolder", doc.Entries[3].Kind);
        Assert.False(VirtualFolderDocumentParser.IsEmbeddedGroup(doc.Entries[3]));
        Assert.Equal("LegacyExternal.mfevirtual", doc.Entries[3].Path);
    }

    [Fact]
    public void Projected_mount_path_is_sibling_stem()
    {
        var mount = VirtualFolderDocumentParser.ProjectedMountPath(@"D:\Collections\Work.mfevirtual");
        Assert.Equal(@"D:\Collections\Work", mount);
    }

    [Fact]
    public void Resolves_relative_entry_paths()
    {
        var entry = new VirtualFolderEntry { Path = "docs/a.pdf", Relative = true };
        var resolved = VirtualFolderDocumentParser.ResolveEntryPath(@"D:\Project\Refs.mfevirtual", entry);
        Assert.Equal(@"D:\Project\docs\a.pdf", resolved);
    }

    static string FindFixture(string name)
    {
        var candidates = new[]
        {
            Path.Combine(AppContext.BaseDirectory, "fixtures", name),
            Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", "..", "src", "tests", "fixtures", "virtualFolder", name))
        };
        foreach (var c in candidates)
            if (File.Exists(c)) return c;
        throw new FileNotFoundException("Fixture not found: " + name);
    }
}
