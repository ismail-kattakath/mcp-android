<div align="center">
  <img src="icon.png" alt="Android Device Control" width="120" />
  <h1>Android Device Control</h1>
  <p><strong>Comprehensive Android device control for AI agents</strong></p>
  <p>ADB + scrcpy H.264 vision streaming + fast input — 37 tools</p>

  [![npm version](https://img.shields.io/npm/v/@ismail-kattakath/mcp-android?logo=npm&color=CB0000)](https://www.npmjs.com/package/@ismail-kattakath/mcp-android)
  [![Docker Pulls](https://img.shields.io/docker/pulls/ghcr.io/ismail-kattakath/mcp-android?logo=docker)](https://github.com/ismail-kattakath/mcp-android/pkgs/container/mcp-android)
  [![CI](https://github.com/ismail-kattakath/mcp-android/actions/workflows/ci.yml/badge.svg)](https://github.com/ismail-kattakath/mcp-android/actions/workflows/ci.yml)
  [![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
  [![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen?logo=nodedotjs)](https://nodejs.org)
  [![MCP](https://img.shields.io/badge/MCP-compatible-blue)](https://modelcontextprotocol.io)
</div>

---

Give your AI agent full control over Android devices — take screenshots, tap and swipe, type text, stream live video, install APKs, read logcat, manage apps, and more. Works over USB or WiFi ADB, with or without scrcpy streaming, inside Docker or via npx.

## Features

- **37 MCP tools** across 11 categories — devices, vision, input, UI, apps, system, files, clipboard, notifications, screen control, WiFi ADB
- **Live H.264 vision streaming** via scrcpy standalone server + ffmpeg → JPEG resources at ~2 FPS
- **Fast input** via scrcpy control protocol (~5ms per event vs ~100-300ms for `adb shell input`)
- **Snapshot mode** — screenshot + UI dump work without scrcpy, no extra deps
- **Docker MCP Toolkit** — works as a Docker MCP server with host ADB daemon delegation
- **WiFi ADB** — full manage-connect-disconnect lifecycle
- **APK install**, **logcat**, **Activity Manager**, **Package Manager** commands

## Quick Start

### Docker (recommended)

```bash
# USB-connected device (requires --privileged)
docker run --rm -i \
  --privileged \
  -v /dev/bus/usb:/dev/bus/usb \
  ghcr.io/ismail-kattakath/mcp-android:latest

# WiFi ADB / Docker MCP gateway (no USB passthrough needed)
docker run --rm -i \
  --network host \
  -e ADB_SERVER_HOST=host.docker.internal \
  -e ADB_SERVER_PORT=5037 \
  ghcr.io/ismail-kattakath/mcp-android:latest

# With scrcpy vision streaming
docker run --rm -i \
  --network host \
  -e ADB_SERVER_HOST=host.docker.internal \
  -v /path/to/scrcpy-server:/opt/scrcpy-server:ro \
  -e SCRCPY_SERVER_PATH=/opt/scrcpy-server \
  -e SCRCPY_SERVER_VERSION=3.2 \
  ghcr.io/ismail-kattakath/mcp-android:latest
```

### npx

```bash
npx @ismail-kattakath/mcp-android
```

> **Note:** `adb` must be in your PATH. Install via `brew install android-platform-tools` (macOS) or `sudo apt install adb` (Ubuntu).

## Client Setup

### Claude Desktop

Add to `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "mcp-android": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "--network", "host",
        "-e", "ADB_SERVER_HOST=host.docker.internal",
        "-e", "ADB_SERVER_PORT=5037",
        "ghcr.io/ismail-kattakath/mcp-android:latest"
      ]
    }
  }
}
```

**npx variant:**
```json
{
  "mcpServers": {
    "mcp-android": {
      "command": "npx",
      "args": ["-y", "@ismail-kattakath/mcp-android"]
    }
  }
}
```

### Claude Code CLI

```bash
claude mcp add mcp-android -- docker run --rm -i \
  --network host \
  -e ADB_SERVER_HOST=host.docker.internal \
  ghcr.io/ismail-kattakath/mcp-android:latest
```

Or add to your project's `.mcp.json`:

```json
{
  "mcpServers": {
    "mcp-android": {
      "command": "docker",
      "args": [
        "run", "--rm", "-i",
        "--network", "host",
        "-e", "ADB_SERVER_HOST=host.docker.internal",
        "ghcr.io/ismail-kattakath/mcp-android:latest"
      ]
    }
  }
}
```

### Cursor

Open **Cursor Settings → MCP → Add Server** and paste:

```json
{
  "mcp-android": {
    "command": "docker",
    "args": [
      "run", "--rm", "-i",
      "--network", "host",
      "-e", "ADB_SERVER_HOST=host.docker.internal",
      "ghcr.io/ismail-kattakath/mcp-android:latest"
    ]
  }
}
```

### VS Code (Cline / Continue)

**Cline** — add to `.vscode/cline_mcp_settings.json`:

```json
{
  "mcpServers": {
    "mcp-android": {
      "command": "npx",
      "args": ["-y", "@ismail-kattakath/mcp-android"]
    }
  }
}
```

**Continue** — add to `~/.continue/config.json`:

```json
{
  "mcpServers": [
    {
      "name": "mcp-android",
      "command": "npx",
      "args": ["-y", "@ismail-kattakath/mcp-android"]
    }
  ]
}
```

### Zed

Add to your Zed `settings.json`:

```json
{
  "context_servers": {
    "mcp-android": {
      "command": {
        "path": "npx",
        "args": ["-y", "@ismail-kattakath/mcp-android"]
      }
    }
  }
}
```

### Docker MCP Toolkit (Docker Desktop)

```bash
# Build and add the image to your toolkit profile
docker build -t mcp-android .
docker mcp profile server add \
  --profile <your-profile> \
  mcp-android:latest
```

---

## Vision Streaming Setup

Vision streaming requires the [scrcpy standalone server](https://github.com/Genymobile/scrcpy/releases) binary. Download `scrcpy-server-v3.2` (or later) and provide its path:

```bash
# Download scrcpy server (example for v3.2)
wget https://github.com/Genymobile/scrcpy/releases/download/v3.2/scrcpy-server-v3.2 \
  -O /tmp/scrcpy-server

docker run --rm -i \
  --network host \
  -e ADB_SERVER_HOST=host.docker.internal \
  -v /tmp/scrcpy-server:/opt/scrcpy-server:ro \
  -e SCRCPY_SERVER_PATH=/opt/scrcpy-server \
  -e SCRCPY_SERVER_VERSION=3.2 \
  ghcr.io/ismail-kattakath/mcp-android:latest
```

Once the stream is started with `android.vision.startStream`, the server registers a live resource at `android://device/<serial>/frame/latest.jpg`. Read it to get the latest JPEG frame.

---

## Tool Reference

### Device (2 tools)

| Tool | Description |
|------|-------------|
| `android.devices.list` | List all connected devices (`adb devices -l`) |
| `android.devices.info` | Get device model, brand, SDK version via `getprop` |

### Vision (3 tools)

| Tool | Description |
|------|-------------|
| `android.vision.startStream` | Start H.264 stream via scrcpy → JPEG resource; enables fast input |
| `android.vision.stopStream` | Stop stream and remove frame resource |
| `android.vision.snapshot` | Take a PNG screenshot via `adb exec-out screencap -p` |

### Input (7 tools)

| Tool | Description |
|------|-------------|
| `android.input.tap` | Tap at (x, y) — fast via scrcpy or `adb shell input` |
| `android.input.swipe` | Swipe with duration |
| `android.input.text` | Type text (full UTF-8 via scrcpy, or `adb shell input text`) |
| `android.input.keyevent` | Send keycode (HOME=3, BACK=4, POWER=26, ENTER=66…) |
| `android.input.longPress` | Long press with duration |
| `android.input.pinch` | Pinch gesture (zoom in/out) |
| `android.input.dragDrop` | Drag and drop |

### UI Automation (2 tools)

| Tool | Description |
|------|-------------|
| `android.ui.dump` | Dump full UI hierarchy XML via uiautomator |
| `android.ui.findElement` | Find elements by text, resource-id, class, or content-desc; returns center coordinates |

### Apps (5 tools)

| Tool | Description |
|------|-------------|
| `android.app.start` | Launch app by package name (+ optional activity) |
| `android.app.stop` | Force-stop app |
| `android.app.install` | Install APK via `adb install -r` |
| `android.apps.list` | List installed packages (all / system-only / third-party) |
| `android.activity.current` | Get currently focused package and activity |

### System (4 tools)

| Tool | Description |
|------|-------------|
| `android.shell.exec` | Execute arbitrary shell command via `adb shell` |
| `android.system.logcat` | Capture logcat output (with optional filter + line limit) |
| `android.system.activityManager` | Run `am` commands (start, broadcast, force-stop, etc.) |
| `android.system.packageManager` | Run `pm` commands (list, grant, revoke, clear, etc.) |

### Files (3 tools)

| Tool | Description |
|------|-------------|
| `android.file.push` | Push local file to device |
| `android.file.pull` | Pull file from device to host |
| `android.file.list` | List directory contents (`ls -la`) |

### Clipboard (2 tools)

| Tool | Description |
|------|-------------|
| `android.clipboard.get` | Get clipboard content via `dumpsys clipboard` |
| `android.clipboard.set` | Set clipboard content (limited on Android 10+) |

### Notifications (1 tool)

| Tool | Description |
|------|-------------|
| `android.notifications.get` | Dump all current notifications via `dumpsys notification` |

### Screen (4 tools)

| Tool | Description |
|------|-------------|
| `android.screen.wake` | Wake screen (KEYCODE_WAKEUP) |
| `android.screen.sleep` | Put screen to sleep (KEYCODE_SLEEP) |
| `android.screen.isOn` | Check if screen is on |
| `android.screen.unlock` | Wake and unlock screen (no-PIN devices only) |

### WiFi ADB (4 tools)

| Tool | Description |
|------|-------------|
| `android.adb.connectWifi` | Connect to device over WiFi |
| `android.adb.disconnectWifi` | Disconnect WiFi ADB connection |
| `android.adb.enableTcpip` | Enable TCP/IP mode (USB required first) |
| `android.adb.getDeviceIp` | Get device WiFi IP address |

---

## Configuration

All configuration is via environment variables:

| Variable | Default | Description |
|----------|---------|-------------|
| `ADB_PATH` | `adb` | Path to the `adb` binary |
| `FFMPEG_PATH` | `ffmpeg` | Path to the `ffmpeg` binary |
| `SCRCPY_SERVER_PATH` | _(empty)_ | Path to scrcpy-server binary (enables vision streaming) |
| `SCRCPY_SERVER_VERSION` | _(empty)_ | Version string matching the server binary (e.g. `3.2`) |
| `ADB_SERVER_HOST` | _(empty)_ | ADB server host (`host.docker.internal` in Docker) |
| `ADB_SERVER_PORT` | `5037` | ADB server port |
| `DEFAULT_MAX_SIZE` | `1024` | Max stream dimension in pixels |
| `DEFAULT_MAX_FPS` | `30` | Stream frame rate |
| `DEFAULT_FRAME_FPS` | `2` | JPEG extraction frame rate for MCP resources |
| `LOG_LEVEL` | `2` | `0`=silent, `1`=errors, `2`=info, `3`=debug |

---

## WiFi ADB Workflow

```
1. Connect device via USB
2. android.adb.enableTcpip   { serial: "USB_SERIAL", port: 5555 }
3. android.adb.getDeviceIp   { serial: "USB_SERIAL" }
   → { ipAddress: "192.168.1.42" }
4. Unplug USB
5. android.adb.connectWifi   { ipAddress: "192.168.1.42", port: 5555 }
6. Use "192.168.1.42:5555" as serial for all subsequent tools
```

---

## Building from Source

```bash
git clone https://github.com/ismail-kattakath/mcp-android.git
cd mcp-android
npm install
npm run build
node dist/index.js
```

```bash
# Docker
docker build -t mcp-android .
docker run --rm -i --network host \
  -e ADB_SERVER_HOST=host.docker.internal \
  mcp-android
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). All PRs welcome — bug fixes, new tools, documentation improvements.

## Credits

This project combines and extends two excellent open-source projects:

- [mcp-scrcpy-vision](https://github.com/invidtiv/mcp-scrcpy-vision) by invidtiv — scrcpy H.264 streaming + fast input
- [adb-mcp](https://github.com/srmorete/adb-mcp) by srmorete — ADB tool wrappers

## License

[MIT](LICENSE)
