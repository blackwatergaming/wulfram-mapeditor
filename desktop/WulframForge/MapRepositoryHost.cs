using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;

namespace WulframForge;

internal sealed class MapRepositoryHost
{
    private static readonly string[] SourceFiles =
    [
        "map.json",
        "terrain.tsv",
        "entities.jsonl",
        "tagmap.txt",
        "tagmap2.txt",
    ];

    private static readonly Regex SlugPattern = new(
        "^[a-z0-9](?:[a-z0-9_-]{0,79})$",
        RegexOptions.CultureInvariant | RegexOptions.Compiled);

    private static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web);
    private readonly Form owner;
    private readonly string settingsPath;
    private string repository;

    public MapRepositoryHost(string[] args, Form owner)
    {
        this.owner = owner;
        settingsPath = Path.Combine(
            Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
            "BlackwaterGaming",
            "WulframForge",
            "settings.json");
        repository = ResolveRepository(args);
    }

    public void HandleMessage(object? sender, CoreWebView2WebMessageReceivedEventArgs eventArgs)
    {
        if (sender is not CoreWebView2 webView
            || !eventArgs.Source.StartsWith("https://wulfram-forge.local/", StringComparison.OrdinalIgnoreCase))
            return;

        string id = "unknown";
        try
        {
            using JsonDocument message = JsonDocument.Parse(eventArgs.WebMessageAsJson);
            JsonElement root = message.RootElement;
            id = RequiredString(root, "id");
            string action = RequiredString(root, "action");
            object result = action switch
            {
                "list" => ListMaps(),
                "load" => LoadMap(RequiredString(root, "slug")),
                "save" => SaveMap(RequiredString(root, "slug"), root.GetProperty("files")),
                "publish" => PublishMap(RequiredString(root, "slug")),
                "configure" => ConfigureRepository(),
                _ => throw new InvalidOperationException($"Unknown native repository operation: {action}"),
            };
            webView.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, ok = true, result }, JsonOptions));
        }
        catch (Exception error)
        {
            webView.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, ok = false, error = error.Message }, JsonOptions));
        }
    }

    private object ListMaps()
    {
        string root = RequireRepository();
        string mapsRoot = Path.Combine(root, "maps");
        List<MapSummary> maps = [];
        if (Directory.Exists(mapsRoot))
        {
            foreach (string directory in Directory.EnumerateDirectories(mapsRoot).OrderBy(value => value, StringComparer.OrdinalIgnoreCase))
            {
                string slug = Path.GetFileName(directory);
                if (!SlugPattern.IsMatch(slug)) continue;
                foreach (string fileName in SourceFiles)
                {
                    if (!File.Exists(Path.Combine(directory, fileName)))
                        throw new InvalidDataException($"maps/{slug} is missing {fileName}.");
                }
                using JsonDocument metadata = JsonDocument.Parse(File.ReadAllText(Path.Combine(directory, "map.json")));
                JsonElement document = metadata.RootElement;
                JsonElement terrain = document.GetProperty("terrain");
                int entities = File.ReadLines(Path.Combine(directory, "entities.jsonl")).Count(line => !string.IsNullOrWhiteSpace(line));
                maps.Add(new MapSummary(
                    slug,
                    RequiredString(document, "name"),
                    RequiredString(document, "updatedAt"),
                    terrain.GetProperty("width").GetInt32(),
                    terrain.GetProperty("height").GetInt32(),
                    entities));
            }
        }
        GitInfo git = ReadGitInfo(root);
        return new
        {
            repository = root,
            branch = git.Branch,
            remote = git.Remote,
            changes = git.Changes,
            maps = maps.OrderBy(map => map.Name, StringComparer.OrdinalIgnoreCase).ToArray(),
        };
    }

    private object LoadMap(string slug)
    {
        string directory = MapDirectory(slug);
        Dictionary<string, string> files = [];
        foreach (string fileName in SourceFiles)
            files[fileName] = File.ReadAllText(Path.Combine(directory, fileName));
        return new { slug, files };
    }

    private object SaveMap(string slug, JsonElement filesElement)
    {
        string root = RequireRepository();
        string directory = MapDirectory(slug, mustExist: false);
        if (filesElement.ValueKind != JsonValueKind.Object)
            throw new InvalidDataException("Native map save requires a source file object.");
        Directory.CreateDirectory(directory);
        foreach (string fileName in SourceFiles)
        {
            if (!filesElement.TryGetProperty(fileName, out JsonElement value) || value.ValueKind != JsonValueKind.String)
                throw new InvalidDataException($"Native map save is missing {fileName}.");
            File.WriteAllText(Path.Combine(directory, fileName), value.GetString()!, new UTF8Encoding(false));
        }
        GitInfo git = ReadGitInfo(root);
        return new
        {
            slug,
            repository = root,
            branch = git.Branch,
            remote = git.Remote,
            changes = git.Changes,
        };
    }

    private object PublishMap(string slug)
    {
        string root = RequireRepository();
        _ = MapDirectory(slug);
        string stagedBefore = RunGit(root, "diff", "--cached", "--name-only");
        if (!string.IsNullOrWhiteSpace(stagedBefore))
            throw new InvalidOperationException("The maps checkout already has staged changes. Commit or unstage them before publishing.");

        string relative = $"maps/{slug}";
        RunGit(root, "add", "--", relative);
        string staged = RunGit(root, "diff", "--cached", "--name-only", "--", relative);
        bool committed = !string.IsNullOrWhiteSpace(staged);
        if (committed)
        {
            using JsonDocument metadata = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, relative, "map.json")));
            string name = RequiredString(metadata.RootElement, "name");
            RunGit(root, "commit", "-m", $"Update {name}");
            RunGit(root, "push", "origin", "HEAD");
        }
        GitInfo git = ReadGitInfo(root);
        return new
        {
            committed,
            pushed = committed,
            slugs = new[] { slug },
            message = committed ? $"Published {slug}." : "Sources already match Git.",
            repository = root,
            branch = git.Branch,
            remote = git.Remote,
            changes = git.Changes,
            maps = Array.Empty<object>(),
        };
    }

    private object ConfigureRepository()
    {
        using FolderBrowserDialog dialog = new()
        {
            Description = "Select the blackwatergaming/wulfram-maps Git checkout",
            UseDescriptionForTitle = true,
            ShowNewFolderButton = false,
            SelectedPath = Directory.Exists(repository) ? repository : Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory),
        };
        if (dialog.ShowDialog(owner) != DialogResult.OK)
            throw new OperationCanceledException("Repository selection was cancelled.");
        string selected = Path.GetFullPath(dialog.SelectedPath);
        if (!Directory.Exists(Path.Combine(selected, ".git")))
            throw new InvalidOperationException("The selected folder is not a Git checkout.");
        repository = selected;
        Directory.CreateDirectory(Path.GetDirectoryName(settingsPath)!);
        File.WriteAllText(settingsPath, JsonSerializer.Serialize(new { repository }, JsonOptions), new UTF8Encoding(false));
        return ListMaps();
    }

    private string ResolveRepository(string[] args)
    {
        List<string?> candidates = [];
        int option = Array.IndexOf(args, "--maps-repo");
        if (option >= 0 && option + 1 < args.Length) candidates.Add(args[option + 1]);
        candidates.Add(Environment.GetEnvironmentVariable("WULFRAM_MAPS_REPO"));
        if (File.Exists(settingsPath))
        {
            try
            {
                using JsonDocument settings = JsonDocument.Parse(File.ReadAllText(settingsPath));
                if (settings.RootElement.TryGetProperty("repository", out JsonElement saved)) candidates.Add(saved.GetString());
            }
            catch (JsonException) { }
        }
        candidates.Add(Path.GetFullPath(Path.Combine(Environment.CurrentDirectory, "..", "wulfram-maps")));
        candidates.Add(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "wulfram-maps"));
        candidates.Add(Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "wulfram-maps")));
        foreach (string? candidate in candidates)
        {
            if (string.IsNullOrWhiteSpace(candidate)) continue;
            string resolved = Path.GetFullPath(candidate);
            if (Directory.Exists(Path.Combine(resolved, ".git"))) return resolved;
        }
        return Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "wulfram-maps");
    }

    private string RequireRepository()
    {
        string resolved = Path.GetFullPath(repository);
        if (!Directory.Exists(Path.Combine(resolved, ".git")))
            throw new DirectoryNotFoundException(
                $"No wulfram-maps Git checkout was found at {resolved}. Use the folder button, set WULFRAM_MAPS_REPO, or clone blackwatergaming/wulfram-maps beside the editor.");
        return resolved;
    }

    private string MapDirectory(string slug, bool mustExist = true)
    {
        if (!SlugPattern.IsMatch(slug))
            throw new InvalidDataException("Map slug must be 1–80 lowercase letters, numbers, dashes, or underscores.");
        string mapsRoot = Path.Combine(RequireRepository(), "maps");
        string directory = Path.GetFullPath(Path.Combine(mapsRoot, slug));
        string rooted = Path.GetFullPath(mapsRoot) + Path.DirectorySeparatorChar;
        if (!directory.StartsWith(rooted, StringComparison.OrdinalIgnoreCase))
            throw new InvalidDataException("Map path escapes the repository.");
        if (mustExist && !Directory.Exists(directory)) throw new DirectoryNotFoundException($"Unknown repository map: {slug}");
        return directory;
    }

    private static string RequiredString(JsonElement element, string property)
    {
        if (!element.TryGetProperty(property, out JsonElement value) || value.ValueKind != JsonValueKind.String)
            throw new InvalidDataException($"Native request is missing {property}.");
        return value.GetString()!;
    }

    private static GitInfo ReadGitInfo(string root)
    {
        string branch = RunGit(root, "branch", "--show-current");
        string remote = RunGit(root, "remote", "get-url", "origin");
        int changes = RunGit(root, "status", "--porcelain", "--", "maps")
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries).Length;
        return new GitInfo(branch, remote, changes);
    }

    private static string RunGit(string root, params string[] arguments)
    {
        ProcessStartInfo start = new("git")
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        start.ArgumentList.Add("-C");
        start.ArgumentList.Add(root);
        foreach (string argument in arguments) start.ArgumentList.Add(argument);
        using Process process = Process.Start(start) ?? throw new InvalidOperationException("Could not start local git.");
        string output = process.StandardOutput.ReadToEnd();
        string error = process.StandardError.ReadToEnd();
        process.WaitForExit();
        if (process.ExitCode != 0)
            throw new InvalidOperationException($"git {string.Join(' ', arguments)} failed: {error.Trim()}");
        return output.Trim();
    }

    private sealed record GitInfo(string Branch, string Remote, int Changes);
    private sealed record MapSummary(string Slug, string Name, string UpdatedAt, int Width, int Height, int Entities);
}
