# Changelog

## 1.0.2

### Patch Changes

- c1b3891: Fix npm OIDC trusted publishing: remove registry-url from setup-node and upgrade to Node 24 (npm v11.5+) to support the OIDC handshake required by the npm registry.

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-05-04

### Added

- Initial release combining [mcp-scrcpy-vision](https://github.com/invidtiv/mcp-scrcpy-vision) and [adb-mcp](https://github.com/srmorete/adb-mcp)
- 37 MCP tools across 11 categories: devices, vision, input, UI, apps, system, files, clipboard, notifications, screen, WiFi ADB
- Scrcpy H.264 vision streaming with live JPEG frame resources
- Fast input via scrcpy control protocol (~5ms vs ~100ms for adb shell)
- ADB server delegation via `ADB_SERVER_HOST`/`ADB_SERVER_PORT` for Docker MCP gateway use
- APK installation, logcat capture, Activity Manager and Package Manager commands
- WiFi ADB management (connect, disconnect, enable TCP/IP, get device IP)
- Multi-stage Docker build (node:22-alpine + android-tools + ffmpeg)
- Docker MCP Toolkit integration with OCI labels
- npx support via `@ismail-kattakath/mcp-android`
