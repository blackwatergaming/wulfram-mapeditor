using System.Diagnostics;
using System.Text;
using System.Text.Json;
using System.Text.RegularExpressions;
using Microsoft.Web.WebView2.Core;

namespace WulframForge;

internal sealed class MapRepositoryHost
{
    private const string DefaultBranch = "main";
    private const string RepositoryName = "blackwatergaming/wulfram-maps";
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
                "diagnostics" => Diagnostics(),
                "branch" => SwitchBranch(RequiredString(root, "branch"), root.TryGetProperty("create", out JsonElement create) && create.GetBoolean()),
                _ => throw new InvalidOperationException($"Unknown native repository operation: {action}"),
            };
            webView.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, ok = true, result }, JsonOptions));
        }
        catch (Exception error)
        {
            webView.PostWebMessageAsJson(JsonSerializer.Serialize(new { id, ok = false, error = error.Message }, JsonOptions));
        }
    }

    private Dictionary<string, object?> ListMaps()
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
        return new Dictionary<string, object?>
        {
            ["repository"] = root,
            ["branch"] = git.Branch,
            ["remote"] = git.Remote,
            ["changes"] = git.Changes,
            ["branches"] = git.Branches,
            ["defaultBranch"] = DefaultBranch,
            ["maps"] = maps.OrderBy(map => map.Name, StringComparer.OrdinalIgnoreCase).ToArray(),
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
            branches = git.Branches,
            defaultBranch = DefaultBranch,
        };
    }

    private object SwitchBranch(string branch, bool create)
    {
        string root = RequireRepository();
        if (string.IsNullOrWhiteSpace(branch) || branch != branch.Trim() || branch.Length > 120 ||
            !TryRunGit(root, ["check-ref-format", "--branch", branch], out _, out _))
            throw new InvalidDataException($"Invalid Git branch name: {branch}");
        GitInfo current = ReadGitInfo(root);
        if (current.Branch == branch) return ListMaps();
        if (create)
        {
            if (current.Branches.Contains(branch, StringComparer.Ordinal))
                throw new InvalidOperationException($"Branch {branch} already exists.");
            RunGit(root, "switch", "-c", branch);
        }
        else
        {
            if (!string.IsNullOrWhiteSpace(RunGit(root, "status", "--porcelain")))
                throw new InvalidOperationException("Commit, publish, or discard the current checkout changes before switching branches.");
            if (!current.Branches.Contains(branch, StringComparer.Ordinal))
                throw new InvalidOperationException($"Unknown local branch: {branch}");
            RunGit(root, "switch", branch);
        }
        return ListMaps();
    }

    private object PublishMap(string slug)
    {
        string root = RequireRepository();
        _ = MapDirectory(slug);
        string stagedBefore = RunGit(root, "diff", "--cached", "--name-only");
        if (!string.IsNullOrWhiteSpace(stagedBefore))
            throw new InvalidOperationException("The maps checkout already has staged changes. Commit or unstage them before publishing.");

        string relative = $"maps/{slug}";
        GitInfo git = ReadGitInfo(root);
        if (git.Branch == "(detached)")
            throw new InvalidOperationException("Publishing requires a named Git branch.");
        string selectedChanges = RunGit(root, "status", "--porcelain", "--", relative);
        if (git.Branch == DefaultBranch && string.IsNullOrWhiteSpace(selectedChanges))
        {
            Dictionary<string, object?> unchanged = ListMaps();
            unchanged["committed"] = false;
            unchanged["pushed"] = false;
            unchanged["prCreated"] = false;
            unchanged["prUrl"] = "";
            unchanged["baseBranch"] = DefaultBranch;
            unchanged["slugs"] = new[] { slug };
            unchanged["message"] = "Sources already match Git; no pull request was needed.";
            return unchanged;
        }
        if (git.Branch == DefaultBranch)
        {
            string[] outsideChanges = RunGit(root, "status", "--porcelain")
                .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
                .Select(PorcelainPath)
                .Where(changedPath => changedPath != relative && !changedPath.StartsWith(relative + "/", StringComparison.Ordinal))
                .ToArray();
            if (outsideChanges.Length > 0)
                throw new InvalidOperationException($"Cannot create a publishing branch while unrelated changes exist: {string.Join(", ", outsideChanges)}");
            string stem = $"maps/{slug}-{DateTime.UtcNow:yyyyMMdd-HHmm}";
            string branch = stem;
            int suffix = 2;
            while (git.Branches.Contains(branch, StringComparer.Ordinal)) branch = $"{stem}-{suffix++}";
            RunGit(root, "switch", "-c", branch);
            git = ReadGitInfo(root);
        }

        RunGit(root, "add", "--", relative);
        string staged = RunGit(root, "diff", "--cached", "--name-only", "--", relative);
        bool committed = !string.IsNullOrWhiteSpace(staged);
        using JsonDocument metadata = JsonDocument.Parse(File.ReadAllText(Path.Combine(root, relative, "map.json")));
        string name = RequiredString(metadata.RootElement, "name");
        if (committed)
        {
            RunGit(root, "commit", "-m", $"Update {name}");
        }
        int ahead = int.TryParse(RunGit(root, "rev-list", "--count", $"{DefaultBranch}..HEAD"), out int count) ? count : 0;
        if (ahead == 0)
        {
            Dictionary<string, object?> unchanged = ListMaps();
            unchanged["committed"] = committed;
            unchanged["pushed"] = false;
            unchanged["prCreated"] = false;
            unchanged["prUrl"] = "";
            unchanged["baseBranch"] = DefaultBranch;
            unchanged["slugs"] = new[] { slug };
            unchanged["message"] = "This branch has no changes from main; no pull request was needed.";
            return unchanged;
        }

        if (!TryRunProcess("gh", null, ["auth", "status", "--hostname", "github.com"], out _, out _))
            throw new InvalidOperationException("GitHub CLI is not authenticated. Run gh auth login, then retry Publish.");
        RunGit(root, "push", "--set-upstream", "origin", git.Branch);
        string[] viewArguments = ["pr", "view", git.Branch, "--repo", RepositoryName, "--json", "url", "--jq", ".url"];
        bool hasPullRequest = TryRunProcess("gh", root, viewArguments, out string pullRequestUrl, out _)
            && !string.IsNullOrWhiteSpace(pullRequestUrl);
        bool prCreated = false;
        if (!hasPullRequest)
        {
            string body = $"Updates canonical Wulfram map source for `{slug}`.\n\nCreated by Wulfram Forge.";
            string[] createArguments =
            [
                "pr", "create", "--repo", RepositoryName, "--base", DefaultBranch,
                "--head", git.Branch, "--title", $"Update {name}", "--body", body,
            ];
            if (!TryRunProcess("gh", root, createArguments, out pullRequestUrl, out string createError))
            {
                if (!TryRunProcess("gh", root, viewArguments, out pullRequestUrl, out _) || string.IsNullOrWhiteSpace(pullRequestUrl))
                    throw new InvalidOperationException($"Could not open the GitHub pull request: {createError}");
            }
            else
            {
                prCreated = true;
                pullRequestUrl = pullRequestUrl.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
                    .FirstOrDefault(line => line.StartsWith("https://", StringComparison.OrdinalIgnoreCase)) ?? pullRequestUrl;
            }
        }

        Dictionary<string, object?> result = ListMaps();
        result["committed"] = committed;
        result["pushed"] = true;
        result["prCreated"] = prCreated;
        result["prUrl"] = pullRequestUrl;
        result["baseBranch"] = DefaultBranch;
        result["slugs"] = new[] { slug };
        result["message"] = $"{(prCreated ? "Opened" : "Updated")} pull request for {name} into {DefaultBranch}: {pullRequestUrl}";
        return result;
    }

    private object Diagnostics()
    {
        string resolved = Path.GetFullPath(repository);
        List<Dictionary<string, string>> checks = [];
        static Dictionary<string, string> Check(string id, string label, string status, string detail, string fix = "") => new()
        {
            ["id"] = id,
            ["label"] = label,
            ["status"] = status,
            ["detail"] = detail,
            ["fix"] = fix,
        };

        checks.Add(Check("service", "Desktop bridge", "pass", "The embedded maps bridge is responding."));
        bool checkoutExists = Directory.Exists(Path.Combine(resolved, ".git"));
        checks.Add(Check(
            "repository",
            "Maps checkout",
            checkoutExists ? "pass" : "fail",
            checkoutExists ? resolved : $"No Git checkout was found at {resolved}.",
            $"gh repo clone {RepositoryName} \"{resolved}\""));
        bool hasGit = TryRunProcess("git", null, ["--version"], out string gitVersion, out _);
        checks.Add(Check(
            "git",
            "Git command",
            hasGit ? "pass" : "fail",
            hasGit ? gitVersion : "Git is not available on PATH.",
            "Install Git for Windows and restart Wulfram Forge."));
        bool hasGh = TryRunProcess("gh", null, ["--version"], out string ghVersion, out _);
        checks.Add(Check(
            "github-cli",
            "GitHub CLI",
            hasGh ? "pass" : "fail",
            hasGh ? ghVersion.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries).FirstOrDefault() ?? ghVersion : "GitHub CLI is not available on PATH.",
            "Install GitHub CLI, then run: gh auth login"));
        bool hasAuth = hasGh && TryRunProcess("gh", null, ["auth", "status", "--hostname", "github.com"], out _, out _);
        checks.Add(Check(
            "github-auth",
            "GitHub authentication",
            hasAuth ? "pass" : "fail",
            hasAuth ? "Authenticated with github.com." : "GitHub CLI is not authenticated.",
            "Run: gh auth login"));

        GitInfo? info = null;
        if (checkoutExists && hasGit)
        {
            try
            {
                info = ReadGitInfo(resolved);
                string normalizedRemote = info.Remote.Replace('\\', '/');
                bool correctRemote = Regex.IsMatch(normalizedRemote, @"(?:github\.com[/:])blackwatergaming/wulfram-maps(?:\.git)?$", RegexOptions.IgnoreCase | RegexOptions.CultureInvariant);
                checks.Add(Check(
                    "origin",
                    "Origin remote",
                    correctRemote ? "pass" : "warn",
                    string.IsNullOrWhiteSpace(info.Remote) ? "No origin remote is configured." : info.Remote,
                    $"git remote set-url origin https://github.com/{RepositoryName}.git"));
                bool hasMain = info.Branches.Contains(DefaultBranch, StringComparer.Ordinal)
                    || TryRunGit(resolved, ["show-ref", "--verify", "--quiet", $"refs/remotes/origin/{DefaultBranch}"], out _, out _);
                checks.Add(Check(
                    "main",
                    "PR target branch",
                    hasMain ? "pass" : "fail",
                    hasMain ? $"{DefaultBranch} is available." : $"{DefaultBranch} is missing locally and from origin.",
                    $"git fetch origin {DefaultBranch}:{DefaultBranch}"));
                checks.Add(Check(
                    "branch",
                    "Working branch",
                    info.Branch == "(detached)" ? "fail" : info.Branch == DefaultBranch ? "warn" : "pass",
                    info.Branch == DefaultBranch ? "On main; Publish will create a feature branch automatically." : $"On {info.Branch}."));
                checks.Add(Check(
                    "worktree",
                    "Map working tree",
                    info.Changes > 0 ? "warn" : "pass",
                    info.Changes > 0 ? $"{info.Changes} uncommitted map path(s)." : "Map sources are clean."));
            }
            catch (Exception error)
            {
                checks.Add(Check("git-checkout", "Git checkout", "fail", error.Message));
            }
        }

        Dictionary<string, object?> result = new()
        {
            ["ok"] = checks.All(check => check["status"] != "fail"),
            ["service"] = "Wulfram Forge desktop bridge",
            ["repository"] = resolved,
            ["checks"] = checks,
        };
        if (info is not null)
        {
            result["branch"] = info.Branch;
            result["remote"] = info.Remote;
            result["changes"] = info.Changes;
            result["branches"] = info.Branches;
            result["defaultBranch"] = DefaultBranch;
        }
        return result;
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
        if (string.IsNullOrWhiteSpace(branch)) branch = "(detached)";
        string remote = RunGit(root, "remote", "get-url", "origin");
        int changes = RunGit(root, "status", "--porcelain", "--", "maps")
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries).Length;
        string[] branches = RunGit(root, "for-each-ref", "--format=%(refname:short)", "refs/heads")
            .Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries)
            .OrderBy(value => value, StringComparer.Ordinal)
            .ToArray();
        return new GitInfo(branch, remote, changes, branches);
    }

    private static string PorcelainPath(string line)
    {
        int offset = line.Length > 2 && line[2] == ' ' ? 3 : line.Length > 1 && line[1] == ' ' ? 2 : 3;
        string value = line.Length > offset ? line[offset..].Trim() : "";
        int rename = value.LastIndexOf(" -> ", StringComparison.Ordinal);
        if (rename >= 0) value = value[(rename + 4)..];
        return value.Trim('"').Replace('\\', '/');
    }

    private static bool TryRunGit(string root, string[] arguments, out string output, out string error)
    {
        return TryRunProcess("git", null, ["-C", root, .. arguments], out output, out error);
    }

    private static bool TryRunProcess(string command, string? workingDirectory, string[] arguments, out string output, out string error)
    {
        ProcessStartInfo start = new(command)
        {
            UseShellExecute = false,
            RedirectStandardOutput = true,
            RedirectStandardError = true,
            CreateNoWindow = true,
        };
        if (!string.IsNullOrWhiteSpace(workingDirectory)) start.WorkingDirectory = workingDirectory;
        foreach (string argument in arguments) start.ArgumentList.Add(argument);
        try
        {
            using Process process = Process.Start(start) ?? throw new InvalidOperationException($"Could not start local {command}.");
            output = process.StandardOutput.ReadToEnd().Trim();
            error = process.StandardError.ReadToEnd().Trim();
            process.WaitForExit();
            return process.ExitCode == 0;
        }
        catch (Exception exception)
        {
            output = "";
            error = exception.Message;
            return false;
        }
    }

    private static string RunGit(string root, params string[] arguments)
    {
        if (!TryRunGit(root, arguments, out string output, out string error))
            throw new InvalidOperationException($"git {string.Join(' ', arguments)} failed: {error}");
        return output;
    }

    private sealed record GitInfo(string Branch, string Remote, int Changes, string[] Branches);
    private sealed record MapSummary(string Slug, string Name, string UpdatedAt, int Width, int Height, int Entities);
}
