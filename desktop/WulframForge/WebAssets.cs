using System.IO.Compression;
using System.Reflection;

namespace WulframForge;

internal static class WebAssets
{
    public static string Extract()
    {
        string version = typeof(WebAssets).Module.ModuleVersionId.ToString("N");
        string root = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BlackwaterGaming",
            "WulframForge",
            "Web",
            version);
        string marker = Path.Combine(root, ".complete");
        if (File.Exists(marker)) return root;

        Directory.CreateDirectory(root);
        using Stream source = Assembly.GetExecutingAssembly().GetManifestResourceStream("WulframForge.WebAssets.zip")
            ?? throw new InvalidOperationException("The embedded editor assets are missing.");
        using ZipArchive archive = new(source, ZipArchiveMode.Read);
        string rooted = Path.GetFullPath(root) + Path.DirectorySeparatorChar;
        foreach (ZipArchiveEntry entry in archive.Entries)
        {
            string destination = Path.GetFullPath(Path.Combine(root, entry.FullName.Replace('/', Path.DirectorySeparatorChar)));
            if (!destination.StartsWith(rooted, StringComparison.OrdinalIgnoreCase))
                throw new InvalidDataException("An embedded web asset escaped its extraction directory.");
            if (string.IsNullOrEmpty(entry.Name))
            {
                Directory.CreateDirectory(destination);
                continue;
            }
            Directory.CreateDirectory(Path.GetDirectoryName(destination)!);
            entry.ExtractToFile(destination, true);
        }
        File.WriteAllText(marker, version);
        return root;
    }
}
