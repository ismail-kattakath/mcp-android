# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Project Is

**mcp-android** is a Model Context Protocol (MCP) server that exposes 37 tools for AI-driven Android device control. It wraps ADB (Android Debug Bridge) and optionally scrcpy for low-latency streaming and input injection.

## Commands

```bash
npm run build       # Compile TypeScript → dist/
npm run dev         # Run directly via tsx (no build required)
npm run start       # Run compiled server (node dist/index.js)
npm run typecheck   # Type-check without emitting
```

There are no automated tests. CI runs `typecheck` + `build` only; manual testing requires a real Android device.

## Architecture

The server is implemented in six files under `src/`:

| File | Responsibility |
|------|---------------|
| `index.ts` | MCP server entry point; registers all 37 tools and manages streaming sessions (`Map<serial, SessionEntry>`) |
| `adb.ts` | ADB wrapper — spawns `adb` subprocesses for every device operation (screencap, tap, swipe, text input, app install, logcat, etc.) |
| `scrcpySession.ts` | H.264 streaming pipeline: scrcpy-server → TCP socket → ffmpeg → JPEG extraction |
| `scrcpyControl.ts` | Big-endian binary encoder for scrcpy control protocol (touch, key, scroll, text, power events) |
| `jpegParser.ts` | Scans ffmpeg output for JPEG SOI/EOI markers to extract individual frames |
| `config.ts` | Reads and validates environment variables; exports a `log(logLevel, level, message)` helper |

### Tool naming convention

All MCP tools follow `android.<category>.<action>` (e.g., `android.input.tap`, `android.vision.startStream`). Categories: `devices`, `vision`, `input`, `ui`, `apps`, `system`, `files`, `clipboard`, `notifications`, `screen`, `adb`.

### Two operating modes

1. **ADB-only** (default): Snapshot screenshots via `adb exec-out screencap` (~100–300 ms input latency). No extra binaries required.
2. **Streaming** (requires `SCRCPY_SERVER_PATH` + `SCRCPY_SERVER_VERSION`): scrcpy-server streams H.264 over a TCP socket; ffmpeg decodes to JPEG; control messages are sent via scrcpy's binary protocol (~5 ms input latency).

### Adding a new tool

1. Add an ADB helper function in `adb.ts`.
2. Register the tool in `index.ts` via `server.registerTool()` with a Zod schema (use `.describe()` on every field).
3. Update README.md.

## TypeScript Configuration

- **Target/Module**: ES2022 / NodeNext — import paths must use `.js` extensions.
- **Strict mode** is enabled — no `any`, no implicit types.
- **Output**: `dist/` (sourcemaps + declaration files generated).

## Key Environment Variables

| Variable | Default | Notes |
|----------|---------|-------|
| `ADB_PATH` | `adb` | Path to adb binary |
| `FFMPEG_PATH` | `ffmpeg` | Required for streaming |
| `SCRCPY_SERVER_PATH` | — | Enables streaming mode |
| `SCRCPY_SERVER_VERSION` | — | e.g. `"3.2"` |
| `ADB_SERVER_HOST` | — | For remote/Docker ADB daemon (`host.docker.internal`) |
| `ADB_SERVER_PORT` | `5037` | ADB daemon port |
| `LOG_LEVEL` | `2` | `0`=silent `1`=errors `2`=info `3`=debug |

## MCP Resources

- `android://devices` — list of connected devices
- `android://device/<serial>/frame/latest.jpg` — latest JPEG frame (streaming mode only)

## Dependencies

- `@modelcontextprotocol/sdk` — MCP protocol
- `zod` — runtime schema validation for all tool inputs
- Dev: `tsx` (run without build), `typescript`

## Docker

Multi-stage Dockerfile: builder (Node 22 alpine, compiles TS) → runtime (Node 22 alpine + android-tools + ffmpeg). Mount the scrcpy-server jar at `/opt/scrcpy` to enable streaming. Remote ADB daemon is configured via `ADB_SERVER_HOST=host.docker.internal`.
