using System.Diagnostics;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;

namespace WulframForge;

internal sealed class MainForm : Form
{
    private readonly WebView2 webView = new() { Dock = DockStyle.Fill };
    private readonly MapRepositoryHost repositoryHost;

    public MainForm(string[] args)
    {
        repositoryHost = new MapRepositoryHost(args, this);
        Text = "Wulfram Forge";
        BackColor = Color.FromArgb(16, 18, 20);
        ForeColor = Color.FromArgb(233, 230, 225);
        AutoScaleMode = AutoScaleMode.Dpi;
        MinimumSize = new Size(960, 640);
        StartPosition = FormStartPosition.CenterScreen;
        WindowState = FormWindowState.Maximized;
        Controls.Add(webView);
        Shown += async (_, _) => await InitializeWebViewAsync();
    }

    private async Task InitializeWebViewAsync()
    {
        try
        {
            string webRoot = WebAssets.Extract();
            string userData = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "BlackwaterGaming",
                "WulframForge",
                "WebView2");
            Directory.CreateDirectory(userData);

            string fixedRuntime = Path.Combine(AppContext.BaseDirectory, "WebView2Runtime");
            string? browserFolder = File.Exists(Path.Combine(fixedRuntime, "msedgewebview2.exe"))
                ? fixedRuntime
                : null;
            string? debuggingPort = Environment.GetEnvironmentVariable("WULFRAM_FORGE_REMOTE_DEBUGGING_PORT");
            CoreWebView2EnvironmentOptions? options = int.TryParse(debuggingPort, out int port) && port is > 0 and <= 65535
                ? new CoreWebView2EnvironmentOptions($"--remote-debugging-port={port}")
                : null;
            CoreWebView2Environment environment = await CoreWebView2Environment.CreateAsync(browserFolder, userData, options);
            await webView.EnsureCoreWebView2Async(environment);
            webView.ZoomFactor = 1.0;

            webView.CoreWebView2.Settings.IsStatusBarEnabled = false;
            webView.CoreWebView2.Settings.IsZoomControlEnabled = false;
            webView.CoreWebView2.Settings.AreDevToolsEnabled = true;
            webView.CoreWebView2.Settings.AreDefaultContextMenusEnabled = true;
            webView.CoreWebView2.SetVirtualHostNameToFolderMapping(
                "wulfram-forge.local",
                webRoot,
                CoreWebView2HostResourceAccessKind.DenyCors);
            webView.CoreWebView2.WebMessageReceived += repositoryHost.HandleMessage;
            webView.CoreWebView2.NewWindowRequested += (_, eventArgs) =>
            {
                eventArgs.Handled = true;
                if (Uri.TryCreate(eventArgs.Uri, UriKind.Absolute, out Uri? uri)
                    && (uri.Scheme == Uri.UriSchemeHttp || uri.Scheme == Uri.UriSchemeHttps))
                {
                    Process.Start(new ProcessStartInfo(uri.AbsoluteUri) { UseShellExecute = true });
                }
            };
            webView.CoreWebView2.Navigate("https://wulfram-forge.local/index.html");
        }
        catch (Exception error)
        {
            MessageBox.Show(
                this,
                $"Wulfram Forge could not start Edge WebView2.\n\n{error.Message}",
                "Wulfram Forge startup error",
                MessageBoxButtons.OK,
                MessageBoxIcon.Error);
            Close();
        }
    }
}
