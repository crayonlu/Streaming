<p align="center">
  <img src="assets/app-icon.png" alt="Streaming" width="80" />
</p>

<h1 align="center">Streaming</h1>

<p align="center">跨平台直播桌面客户端</p>

<p align="center">
  <img src="assets/demo.png" alt="Streaming" width="100%" />
</p>

## 功能

- **多平台直播** -- B站、斗鱼、虎牙
- **直播回放** -- 斗鱼全量录像
- **智能线路** -- 多 CDN 自动择优，画质自由切换
- **收藏同步** -- 跨平台关注列表统一管理
- **轻量高效** -- 极低资源占用，极小包体

## 安装

### 一键安装 / 更新（推荐）

**macOS / Linux**

```bash
curl -fsSL https://raw.githubusercontent.com/crayonlu/Streaming/main/scripts/install.sh | bash
```

**Windows（PowerShell）**

```powershell
irm https://raw.githubusercontent.com/crayonlu/Streaming/main/scripts/install.ps1 | iex
```

脚本会自动识别系统与架构，从 GitHub Releases 下载对应安装包并装好。**重复执行同一条命令就是更新**，不需要先卸载旧版本。

常用参数：

```bash
bash install.sh --check        # 只检查有没有新版本，不安装
bash install.sh --print-url    # 只打印当前平台的下载直链
bash install.sh -v v0.6.0      # 安装指定版本
bash install.sh --force        # 版本相同也强制重装
bash install.sh -h             # 查看全部参数
```

| 参数 | 说明 |
| --- | --- |
| `-v, --version <ver>` | 安装指定版本，如 `v0.6.0` 或 `0.6.0`。默认最新版 |
| `-d, --dir <path>` | 安装目录。macOS 默认 `/Applications`（不可写时回退到 `~/Applications`）；Linux 默认 `~/.local/bin` |
| `--deb` / `--rpm` | 仅 Linux：改装 `.deb` / `.rpm` 包（需要 sudo）。默认用 AppImage，免 sudo |
| `--check` | 只检查更新，不安装 |
| `--print-url` | 只打印下载直链，不安装 |
| `--force` | 版本相同也重装 |
| `--no-quarantine` | 仅 macOS：不自动清除 Gatekeeper 隔离属性（不推荐） |
| `-y, --yes` | 跳过确认 |

环境变量：`GITHUB_TOKEN`（提高 GitHub API 速率限制）、`STREAMING_REPO`（覆盖仓库地址）、`NO_COLOR`（关闭彩色输出）。

从本仓库克隆后也可以直接跑：`bash scripts/install.sh`。

### 手动下载

到 [Releases](https://github.com/crayonlu/Streaming/releases) 选对应文件：

| 平台 | 文件 |
| --- | --- |
| macOS（Apple Silicon） | `streaming_<版本>_aarch64.dmg` |
| Windows（x64） | `streaming_<版本>_x64-setup.exe` / `streaming_<版本>_x64_en-US.msi` |
| Linux（x64） | `streaming_<版本>_amd64.AppImage` / `.deb` / `.rpm` |

> 目前只发布 Apple Silicon 的 macOS 构建，以及 x64 的 Windows / Linux 构建。Intel Mac 和 Linux arm64 需要自行编译：`pnpm tauri build`。

想拿直链用 `--print-url` 最省事：

```bash
bash install.sh --print-url
# https://github.com/crayonlu/Streaming/releases/download/v0.6.0/streaming_0.6.0_aarch64.dmg
```

文件名里带版本号，所以 `releases/latest/download/<文件名>` 这种固定写法没法跨版本使用 —— 脚本会先解析最新 tag，再拼出对应的直链。

### macOS 首次打开被拦截？

Release 里的构建**没有做代码签名和公证（notarization）**，所以从浏览器下载的 `.dmg` 会带上隔离属性，双击时 macOS 可能提示「已损坏」或「无法验证开发者」。

安装脚本已经处理了这一点：它用 `curl` 直接下载（不产生隔离属性），安装后还会再清一遍隔离标记。如果仍然被拦截，手动清掉再打开：

```bash
xattr -dr com.apple.quarantine /Applications/streaming.app
```

> 如果之前已经点过一次并被拦下，macOS 会记住这个路径的拒绝结果，只清属性可能仍然打不开。换个目录重装即可：
> `bash install.sh --dir ~/Applications`

## License

[MIT](LICENSE)

## 致谢

菜单栏托盘图标取自 [Lucide](https://lucide.dev) 的 `radio-tower`（ISC License，Copyright © Lucide Icons and Contributors），
源文件为 `src-tauri/icons/tray-icon.svg`，由 `src-tauri/icons/gen_tray_icon.py` 生成 template image 形式的 PNG。
完整许可文本见该脚本头部。
