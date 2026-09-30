<p align="center">
  <img src="assets/app-icon.png" alt="Streaming" width="80" />
</p>

<h1 align="center">Streaming</h1>

<p align="center">A cross-platform desktop client for live-streaming sites</p>

<p align="center">
  <a href="README.zh-CN.md">简体中文</a>
</p>

<p align="center">
  <img src="assets/demo.png" alt="Streaming" width="100%" />
</p>

## Features

- **Three platforms in one place** — Bilibili, Douyu, Huya
- **Live replays** — every recording Douyu keeps
- **Smart stream selection** — picks the best of several CDNs, and switches quality on the fly
- **One follow list** — your followed rooms across all three platforms, in a single list
- **Small and light** — low resource use and a small download

## Install

### One command (recommended)

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/crayonlu/Streaming/main/scripts/install.sh | bash
```

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/crayonlu/Streaming/main/scripts/install.ps1 | iex
```

The script detects your system and architecture, downloads the matching package from GitHub Releases and installs it. **Running the same command again updates the app** — there is no need to uninstall the old version first.

Common options:

```bash
bash install.sh --check        # only check for a newer version
bash install.sh --print-url    # only print the download URL for this platform
bash install.sh -v v0.6.0      # install a specific version
bash install.sh --force        # reinstall even if the version is the same
bash install.sh -h             # all options
```

| Option | Meaning |
| --- | --- |
| `-v, --version <ver>` | Install a specific version, e.g. `v0.6.0` or `0.6.0`. Defaults to the latest |
| `-d, --dir <path>` | Install directory. macOS defaults to `/Applications` (falls back to `~/Applications` when it is not writable); Linux defaults to `~/.local/bin` |
| `--deb` / `--rpm` | Linux only: install the `.deb` / `.rpm` package instead (needs sudo). The AppImage is the default because it needs no sudo |
| `--check` | Only check for updates |
| `--print-url` | Only print the download URL |
| `--force` | Reinstall even if the version is the same |
| `--no-quarantine` | macOS only: do not clear the Gatekeeper quarantine flag (not recommended) |
| `-y, --yes` | Skip the confirmation prompt |

Environment variables: `GITHUB_TOKEN` (raises the GitHub API rate limit), `STREAMING_REPO` (override the repository), `NO_COLOR` (disable coloured output).

After cloning this repository you can also run it directly: `bash scripts/install.sh`.

### Manual download

Pick the file for your platform on the [Releases](https://github.com/crayonlu/Streaming/releases) page:

| Platform | File |
| --- | --- |
| macOS (Apple Silicon) | `streaming_<version>_aarch64.dmg` |
| Windows (x64) | `streaming_<version>_x64-setup.exe` / `streaming_<version>_x64_en-US.msi` |
| Linux (x64) | `streaming_<version>_amd64.AppImage` / `.deb` / `.rpm` |

> Only Apple Silicon macOS builds and x64 Windows / Linux builds are published. Intel Macs and Linux arm64 need a local build: `pnpm tauri build`.

The easiest way to get a direct link is `--print-url`:

```bash
bash install.sh --print-url
# https://github.com/crayonlu/Streaming/releases/download/v0.6.0/streaming_0.6.0_aarch64.dmg
```

File names carry the version, so `releases/latest/download/<file>` cannot work across versions — the script resolves the latest tag first and then builds the matching URL.

### macOS blocks the first launch?

The release builds are **neither code-signed nor notarised**, so a `.dmg` downloaded through a browser carries the quarantine flag and macOS may report it as "damaged" or from an "unidentified developer".

The install script handles this: it downloads with `curl` (which sets no quarantine flag) and clears the flag again after installing. If macOS still blocks it, clear the flag manually and open the app:

```bash
xattr -dr com.apple.quarantine /Applications/streaming.app
```

> If you already tried to open it once and macOS refused, it remembers that decision for that path, so clearing the flag alone may not be enough. Install it somewhere else:
> `bash install.sh --dir ~/Applications`

## Development

```bash
pnpm install
pnpm tauri dev
```

The interface is available in English and Simplified Chinese. It follows the system language and falls back to English outside a Chinese locale; the language can also be chosen under Settings → Appearance.

## License

[MIT](LICENSE)

## Credits

The menu-bar tray icon is `radio-tower` from [Lucide](https://lucide.dev) (ISC License, Copyright © Lucide Icons and Contributors). The source file is `src-tauri/icons/tray-icon.svg`, and `src-tauri/icons/gen_tray_icon.py` turns it into the template-image PNG. The full licence text is in the header of that script.
