#!/usr/bin/env bash
#
# Streaming -- installer / updater for macOS and Linux.
#
# Downloads the right artifact straight from GitHub Releases and puts it in
# place. Running it again upgrades an existing install in place.
#
#   curl -fsSL https://raw.githubusercontent.com/crayonlu/Streaming/main/scripts/install.sh | bash
#
# Run with --help for all options. See the README for details.
#
set -euo pipefail

REPO="${STREAMING_REPO:-crayonlu/Streaming}"
APP_NAME="streaming"
APP_TITLE="Streaming"

# ---------------------------------------------------------------- output ----

if [ -t 1 ] && [ -z "${NO_COLOR:-}" ]; then
  C_RESET=$'\033[0m'; C_DIM=$'\033[2m'; C_BOLD=$'\033[1m'
  C_RED=$'\033[31m'; C_GREEN=$'\033[32m'; C_YELLOW=$'\033[33m'; C_BLUE=$'\033[34m'
else
  C_RESET=''; C_DIM=''; C_BOLD=''; C_RED=''; C_GREEN=''; C_YELLOW=''; C_BLUE=''
fi

info() { printf '%s\n' "${C_BLUE}==>${C_RESET} ${C_BOLD}$*${C_RESET}"; }
ok()   { printf '%s\n' "  ${C_GREEN}✓${C_RESET} $*"; }
note() { printf '%s\n' "  ${C_DIM}$*${C_RESET}"; }
warn() { printf '%s\n' "  ${C_YELLOW}!${C_RESET} $*" >&2; }
die()  { printf '%s\n' "${C_RED}error:${C_RESET} $*" >&2; exit 1; }

usage() {
  cat <<EOF
${C_BOLD}${APP_TITLE} installer / updater${C_RESET}

Downloads the matching build from GitHub Releases and installs it.
Run it again any time to upgrade an existing installation.

${C_BOLD}Usage${C_RESET}
  install.sh [options]

${C_BOLD}Options${C_RESET}
  -v, --version <ver>   Install a specific version, e.g. v0.6.0 or 0.6.0.
                        Default: the latest release.
  -d, --dir <path>      Install location.
                        macOS default: /Applications (falls back to ~/Applications)
                        Linux default: ~/.local/bin
      --deb             Linux only: install the .deb package instead of the
                        AppImage. Requires sudo.
      --rpm             Linux only: install the .rpm package instead of the
                        AppImage. Requires sudo.
      --check           Only report whether an update is available. Installs nothing.
      --print-url       Print the download URL and exit. Installs nothing.
      --force           Reinstall even when the installed version already matches.
      --no-quarantine   macOS only: do NOT clear the Gatekeeper quarantine
                        attribute. The app will then be blocked on first launch.
  -y, --yes             Do not ask for confirmation.
  -h, --help            Show this help.

${C_BOLD}Examples${C_RESET}
  install.sh                       # install or upgrade to the latest release
  install.sh --check               # is there a newer version?
  install.sh -v v0.6.0             # pin an exact version
  install.sh --print-url           # just show me the download link

${C_BOLD}Environment${C_RESET}
  GITHUB_TOKEN          Optional. Raises the GitHub API rate limit.
  STREAMING_REPO        Override the repository (default: ${REPO}).
  NO_COLOR              Set to disable coloured output.
EOF
}

# ------------------------------------------------------------------ args ----

OPT_VERSION=""
OPT_DIR=""
OPT_CHECK=0
OPT_PRINT_URL=0
OPT_FORCE=0
OPT_YES=0
OPT_SKIP_QUARANTINE=0
LINUX_FORMAT="appimage"

while [ $# -gt 0 ]; do
  case "$1" in
    -v|--version)        [ $# -ge 2 ] || die "--version needs a value"; OPT_VERSION="$2"; shift 2 ;;
    -d|--dir)            [ $# -ge 2 ] || die "--dir needs a value"; OPT_DIR="$2"; shift 2 ;;
    --deb)               LINUX_FORMAT="deb"; shift ;;
    --rpm)               LINUX_FORMAT="rpm"; shift ;;
    --check)             OPT_CHECK=1; shift ;;
    --print-url)         OPT_PRINT_URL=1; shift ;;
    --force)             OPT_FORCE=1; shift ;;
    --no-quarantine)     OPT_SKIP_QUARANTINE=1; shift ;;
    -y|--yes)            OPT_YES=1; shift ;;
    -h|--help)           usage; exit 0 ;;
    *)                   die "unknown option: $1 (try --help)" ;;
  esac
done

# -------------------------------------------------------------- platform ----

OS=""; ARCH=""
case "$(uname -s)" in
  Darwin) OS="macos" ;;
  Linux)  OS="linux" ;;
  *)      die "unsupported operating system: $(uname -s). On Windows use scripts/install.ps1 instead." ;;
esac
case "$(uname -m)" in
  arm64|aarch64) ARCH="arm64" ;;
  x86_64|amd64)  ARCH="x64" ;;
  *)             die "unsupported architecture: $(uname -m)" ;;
esac

# Only the architectures CI actually builds are available. Fail loudly rather
# than downloading an artifact that cannot run.
if [ "$OS" = "macos" ] && [ "$ARCH" = "x64" ]; then
  die "no macOS x64 build is published.
       Releases currently ship Apple Silicon (aarch64) builds only, because the
       CI runner is arm64. Build from source on Intel Macs: pnpm tauri build"
fi
if [ "$OS" = "linux" ] && [ "$ARCH" = "arm64" ]; then
  die "no Linux arm64 build is published. Build from source: pnpm tauri build"
fi

command -v curl >/dev/null 2>&1 || die "curl is required but was not found"

# --------------------------------------------------------------- helpers ----

api_get() {
  local path="$1"
  if [ -n "${GITHUB_TOKEN:-}" ]; then
    curl -fsSL --retry 3 \
      -H "Authorization: Bearer ${GITHUB_TOKEN}" \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/${REPO}/${path}" 2>/dev/null || return 1
  else
    curl -fsSL --retry 3 \
      -H "Accept: application/vnd.github+json" \
      "https://api.github.com/repos/${REPO}/${path}" 2>/dev/null || return 1
  fi
}

# Pull a top-level "key": "value" out of a JSON blob without depending on jq.
json_string() {
  printf '%s' "$1" \
    | grep -o "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" \
    | head -1 \
    | sed 's/.*:[[:space:]]*"\(.*\)"$/\1/'
}

# Every asset download URL in the release JSON, one per line.
json_asset_urls() {
  printf '%s' "$1" \
    | grep -o '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]*"' \
    | sed 's/.*"\(https[^"]*\)"$/\1/'
}

normalize_tag() {
  case "$1" in
    v*) printf '%s' "$1" ;;
    *)  printf 'v%s' "$1" ;;
  esac
}

# Filename fragment used to pick the right asset out of the release.
asset_pattern() {
  case "$OS-$ARCH" in
    macos-arm64) printf '%s' "aarch64.dmg" ;;
    windows-x64) printf '%s' "x64-setup.exe" ;;
    linux-x64)
      case "$LINUX_FORMAT" in
        appimage) printf '%s' "amd64.AppImage" ;;
        deb)      printf '%s' "amd64.deb" ;;
        rpm)      printf '%s' "x86_64.rpm" ;;
      esac ;;
  esac
}

# Fallback filename, used when the GitHub API is unavailable or rate limited.
# Mirrors the names produced by tauri-action.
asset_filename() {
  local ver="$1"
  case "$OS-$ARCH" in
    macos-arm64) printf '%s' "${APP_NAME}_${ver}_aarch64.dmg" ;;
    windows-x64) printf '%s' "${APP_NAME}_${ver}_x64-setup.exe" ;;
    linux-x64)
      case "$LINUX_FORMAT" in
        appimage) printf '%s' "${APP_NAME}_${ver}_amd64.AppImage" ;;
        deb)      printf '%s' "${APP_NAME}_${ver}_amd64.deb" ;;
        rpm)      printf '%s' "${APP_NAME}-${ver}-1.x86_64.rpm" ;;
      esac ;;
  esac
}

resolve_install_dir() {
  if [ -n "$OPT_DIR" ]; then
    printf '%s' "$OPT_DIR"
    return
  fi
  case "$OS" in
    macos)
      if [ -w /Applications ]; then
        printf '%s' "/Applications"
      else
        mkdir -p "$HOME/Applications"
        printf '%s' "$HOME/Applications"
      fi ;;
    linux)
      printf '%s' "${XDG_BIN_HOME:-$HOME/.local/bin}" ;;
  esac
}

installed_version() {
  case "$OS" in
    macos)
      local plist="${INSTALL_DIR}/${APP_NAME}.app/Contents/Info.plist"
      [ -f "$plist" ] || return 1
      plutil -extract CFBundleShortVersionString raw "$plist" 2>/dev/null
      ;;
    linux)
      case "$LINUX_FORMAT" in
        deb)
          dpkg-query -W -f='${Version}' "$APP_NAME" 2>/dev/null \
            | sed 's/^[0-9]*://; s/-[0-9]*$//' ;;
        rpm)
          rpm -q --qf '%{VERSION}\n' "$APP_NAME" 2>/dev/null ;;
        *)
          [ -f "$MARKER_FILE" ] && cat "$MARKER_FILE" ;;
      esac ;;
  esac
}

# ------------------------------------------------------------------- plan ----

RELEASE_JSON=""
LATEST_TAG=""
if [ -n "$OPT_VERSION" ]; then
  TARGET_TAG="$(normalize_tag "$OPT_VERSION")"
else
  info "Looking up the latest release"
  if RELEASE_JSON="$(api_get "releases/latest")"; then
    LATEST_TAG="$(json_string "$RELEASE_JSON" tag_name)"
  fi
  if [ -z "$LATEST_TAG" ]; then
    # No API access (offline-ish / rate limited): follow the /releases/latest redirect.
    effective="$(curl -fsSLI -o /dev/null -w '%{url_effective}' \
      "https://github.com/${REPO}/releases/latest" 2>/dev/null || true)"
    LATEST_TAG="${effective##*/}"
  fi
  case "$LATEST_TAG" in
    ""|"latest") die "could not determine the latest release. Check your network, or pin a version with --version." ;;
  esac
  TARGET_TAG="$LATEST_TAG"
fi

TARGET_VER="${TARGET_TAG#v}"

# Fetch the pinned release's asset list when we do not already have it.
if [ -z "$RELEASE_JSON" ] && [ -z "$OPT_VERSION" ]; then
  :
elif [ -z "$RELEASE_JSON" ]; then
  RELEASE_JSON="$(api_get "releases/tags/${TARGET_TAG}" || true)"
fi

PATTERN="$(asset_pattern)"
ASSET_URL="$(json_asset_urls "${RELEASE_JSON:-}" | grep -F -- "$PATTERN" | head -1 || true)"
if [ -z "$ASSET_URL" ]; then
  ASSET_URL="https://github.com/${REPO}/releases/download/${TARGET_TAG}/$(asset_filename "$TARGET_VER")"
  note "GitHub API unavailable, using the direct asset URL"
fi

INSTALL_DIR="$(resolve_install_dir)"
MARKER_FILE="${XDG_DATA_HOME:-$HOME/.local/share}/${APP_NAME}/installed-version"

CURRENT_VER="$(installed_version || true)"

if [ "$OPT_PRINT_URL" = "1" ]; then
  printf '%s\n' "$ASSET_URL"
  exit 0
fi

info "${APP_TITLE} ${TARGET_VER} (${OS}/${ARCH})"

if [ -n "$CURRENT_VER" ]; then
  note "installed: ${CURRENT_VER}"
else
  note "installed: none"
fi
note "target:    ${INSTALL_DIR}"

if [ "$OPT_CHECK" = "1" ]; then
  if [ -z "$CURRENT_VER" ]; then
    printf '\n%s\n' "${C_YELLOW}Not installed.${C_RESET} Run without --check to install ${TARGET_VER}."
    exit 0
  fi
  if [ "$CURRENT_VER" = "$TARGET_VER" ]; then
    printf '\n%s\n' "${C_GREEN}Up to date.${C_RESET} (${CURRENT_VER})"
    exit 0
  fi
  printf '\n%s\n' "${C_YELLOW}Update available:${C_RESET} ${CURRENT_VER} -> ${TARGET_VER}"
  note "run: install.sh"
  exit 0
fi

if [ -n "$CURRENT_VER" ] && [ "$CURRENT_VER" = "$TARGET_VER" ] && [ "$OPT_FORCE" != "1" ]; then
  ok "Already at ${TARGET_VER}, nothing to do."
  note "Use --force to reinstall."
  exit 0
fi

if [ "$OPT_YES" != "1" ] && [ -t 0 ]; then
  if [ -n "$CURRENT_VER" ]; then
    printf '%s ' "Upgrade ${CURRENT_VER} -> ${TARGET_VER}? [y/N]"
  else
    printf '%s ' "Install ${APP_TITLE} ${TARGET_VER} to ${INSTALL_DIR}? [y/N]"
  fi
  read -r reply || reply=""
  case "$reply" in
    [yY]|[yY][eE][sS]) ;;
    *) printf '%s\n' "Aborted."; exit 0 ;;
  esac
fi

# --------------------------------------------------------------- download ----

TMP_DIR="$(mktemp -d "${TMPDIR:-/tmp}/streaming-install.XXXXXX")"
MOUNT_POINT=""

# Always detach before deleting the temp tree, so we never recurse into a
# still-mounted volume.
cleanup() {
  if [ -n "$MOUNT_POINT" ]; then
    detach_image "$MOUNT_POINT"
    MOUNT_POINT=""
  fi
  rm -rf "$TMP_DIR"
}
trap cleanup EXIT

ARTIFACT="${TMP_DIR}/$(basename "${ASSET_URL%%\?*}")"

info "Downloading $(basename "$ARTIFACT")"
note "$ASSET_URL"
if ! curl -fL --retry 3 --progress-bar -o "$ARTIFACT" "$ASSET_URL"; then
  die "download failed. Check that the release and asset still exist:
       $ASSET_URL"
fi
[ -s "$ARTIFACT" ] || die "downloaded file is empty"

# ------------------------------------------------------------- macos path ----

quit_macos_app() {
  local dest_app="$1"
  local exe_dir="${dest_app}/Contents/MacOS"
  pgrep -f "$exe_dir" >/dev/null 2>&1 || return 0
  info "Quitting the running app"
  pkill -f "$exe_dir" >/dev/null 2>&1 || true
  local i=0
  while pgrep -f "$exe_dir" >/dev/null 2>&1 && [ "$i" -lt 24 ]; do
    sleep 0.25; i=$((i + 1))
  done
  if pgrep -f "$exe_dir" >/dev/null 2>&1; then
    warn "app did not exit cleanly, forcing it"
    pkill -9 -f "$exe_dir" >/dev/null 2>&1 || true
    sleep 0.5
  fi
}

# Detach quietly, escalating to -force if the volume is still busy.
detach_image() {
  local target="$1"
  [ -n "$target" ] || return 0
  hdiutil detach "$target" -quiet >/dev/null 2>&1 && return 0
  hdiutil detach "$target" -force >/dev/null 2>&1 || true
}

# An interrupted run can leave the image attached, and the next run then trips
# over the leftover volume. Clear any stale mount of a Streaming disk image.
# Matched on the asset name because every run uses a fresh random temp path, so
# the full image path never repeats.
detach_stale_mounts() {
  local dev
  while IFS= read -r dev; do
    [ -n "$dev" ] || continue
    warn "clearing a stale mount left by an earlier run (${dev})"
    detach_image "$dev"
  done < <(hdiutil info 2>/dev/null | awk -v pat="${APP_NAME}_" '
    /^image-path/ { mine = (index($3, pat) > 0); seen = 0; next }
    mine && !seen && $1 ~ /^\/dev\/disk/ { print $1; seen = 1 }
  ')
}

# Mount the image and echo the mount point.
mount_image() {
  local dmg="$1" mnt="$2"
  mkdir -p "$mnt"
  # Preferred: the modern API, which lets us choose the mount point, so there is
  # never a /Volumes name collision to reason about.
  if diskutil image attach --help >/dev/null 2>&1; then
    if diskutil image attach --mountOptions nobrowse --readOnly \
         --mountPoint "$mnt" "$dmg" >/dev/null 2>&1; then
      printf '%s' "$mnt"
      return 0
    fi
  fi
  # Fallback for older macOS. NOTE: no -quiet, hdiutil prints nothing at all
  # with -quiet and the mount point has to be read back out of its output.
  hdiutil attach -nobrowse -readonly "$dmg" 2>/dev/null | grep -o '/Volumes/.*' | head -1
}

install_macos() {
  local dmg="$1"
  local mount_point src_app dest_app stage backup

  info "Mounting disk image"
  detach_stale_mounts
  mount_point="$(mount_image "$dmg" "${TMP_DIR}/mnt")"
  [ -n "$mount_point" ] || die "failed to mount ${dmg##*/}"
  MOUNT_POINT="$mount_point"

  src_app="$(find "$mount_point" -maxdepth 1 -name '*.app' -print -quit 2>/dev/null)"
  [ -n "$src_app" ] || die "no .app bundle found inside the disk image"

  dest_app="${INSTALL_DIR}/${APP_NAME}.app"
  [ -d "$dest_app" ] && quit_macos_app "$dest_app"

  mkdir -p "$INSTALL_DIR" 2>/dev/null || die "cannot write to ${INSTALL_DIR}"

  # Stage first, swap second: a failure part-way never leaves a broken bundle.
  stage="${INSTALL_DIR}/.${APP_NAME}.app.staging.$$"
  backup="${INSTALL_DIR}/.${APP_NAME}.app.backup.$$"
  rm -rf "$stage" "$backup"

  info "Installing ${APP_NAME}.app -> ${INSTALL_DIR}"
  ditto "$src_app" "$stage" || die "failed to copy the app bundle"

  if [ -d "$dest_app" ]; then
    mv "$dest_app" "$backup" || die "failed to set the existing app aside"
  fi
  if ! mv "$stage" "$dest_app"; then
    [ -d "$backup" ] && mv "$backup" "$dest_app"
    die "failed to install the new bundle (previous version restored)"
  fi
  rm -rf "$backup"

  detach_image "$mount_point"
  MOUNT_POINT=""

  # The released builds are neither code signed nor notarised, so Gatekeeper
  # quarantines them and refuses the first launch. Clearing the attribute is
  # what makes the app runnable.
  if [ "$OPT_SKIP_QUARANTINE" = "1" ]; then
    warn "left the quarantine attribute in place (--no-quarantine)"
    note "If macOS blocks the app, run:"
    note "  xattr -dr com.apple.quarantine \"${dest_app}\""
  else
    if xattr -dr com.apple.quarantine "$dest_app" >/dev/null 2>&1; then
      ok "Cleared the Gatekeeper quarantine attribute"
    else
      warn "could not clear the quarantine attribute"
      note "If macOS blocks the app, run:"
      note "  xattr -dr com.apple.quarantine \"${dest_app}\""
    fi
  fi
}

# ------------------------------------------------------------- linux path ----

install_linux_appimage() {
  local image="$1"
  local dest="${INSTALL_DIR}/${APP_NAME}"
  mkdir -p "$INSTALL_DIR" || die "cannot create ${INSTALL_DIR}"
  info "Installing AppImage -> ${dest}"
  install -m 0755 "$image" "$dest" || die "failed to install to ${dest}"
  mkdir -p "$(dirname "$MARKER_FILE")"
  printf '%s\n' "$TARGET_VER" > "$MARKER_FILE"

  case ":$PATH:" in
    *":${INSTALL_DIR}:"*) ;;
    *) warn "${INSTALL_DIR} is not on your PATH"
       note "Add it with:  echo 'export PATH=\"${INSTALL_DIR}:\$PATH\"' >> ~/.zshrc" ;;
  esac
  if ! ldconfig -p 2>/dev/null | grep -q libfuse; then
    note "No FUSE detected. If the AppImage refuses to start, run it as:"
    note "  ${dest} --appimage-extract-and-run"
  fi
}

install_linux_package() {
  local pkg="$1"
  local mgr
  if [ "$LINUX_FORMAT" = "deb" ]; then
    command -v apt-get >/dev/null 2>&1 || die "apt-get not found; drop --deb and use the AppImage"
    mgr="apt-get"
  else
    if command -v dnf >/dev/null 2>&1; then mgr="dnf"
    elif command -v zypper >/dev/null 2>&1; then mgr="zypper"
    else die "neither dnf nor zypper found; drop --rpm and use the AppImage"; fi
  fi
  info "Installing $(basename "$pkg") with ${mgr} (sudo required)"
  case "$mgr" in
    apt-get) sudo apt-get install -y "$pkg" ;;
    dnf)     sudo dnf install -y "$pkg" ;;
    zypper)  sudo zypper --non-interactive install "$pkg" ;;
  esac
}

# ------------------------------------------------------------------- run -----

case "$OS" in
  macos) install_macos "$ARTIFACT" ;;
  linux)
    if [ "$LINUX_FORMAT" = "appimage" ]; then
      install_linux_appimage "$ARTIFACT"
    else
      install_linux_package "$ARTIFACT"
    fi ;;
esac

# ---------------------------------------------------------------- verify -----

FINAL_VER="$(installed_version || true)"
printf '\n'
if [ -n "$FINAL_VER" ]; then
  ok "${APP_TITLE} ${FINAL_VER} installed"
else
  ok "${APP_TITLE} ${TARGET_VER} installed"
fi

case "$OS" in
  macos)
    note "Launch it with:  open -a \"${INSTALL_DIR}/${APP_NAME}.app\""
    ;;
  linux)
    case "$LINUX_FORMAT" in
      appimage) note "Launch it with:  ${INSTALL_DIR}/${APP_NAME}" ;;
      *)        note "Launch it from your application menu, or run: ${APP_NAME}" ;;
    esac ;;
esac
