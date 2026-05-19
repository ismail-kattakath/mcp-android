# Contributing to mcp-android

Thank you for your interest in contributing! This document explains how to get started.

## Development Setup

### Prerequisites

- Node.js 20+
- Docker (for container builds and testing)
- An Android device or emulator with USB debugging enabled (or WiFi ADB)
- [scrcpy server binary](https://github.com/Genymobile/scrcpy/releases) (optional, for vision streaming)

### Local Setup

```bash
git clone https://github.com/ismail-kattakath/mcp-android.git
cd mcp-android
npm install
npm run build
```

### Running in Development

```bash
# Direct TypeScript execution (no build needed)
npm run dev
```

### Type Checking

```bash
npm run typecheck
```

## Project Structure

```
src/
├── index.ts         # MCP server — all 37 tool registrations
├── adb.ts           # ADB wrappers (exec, shell, screencap, install, etc.)
├── scrcpySession.ts # scrcpy server lifecycle + ffmpeg H.264→JPEG pipeline
├── scrcpyControl.ts # Binary control protocol encoders (touch, swipe, key)
├── jpegParser.ts    # SOI/EOI scanning to extract JPEG frames from ffmpeg output
└── config.ts        # Environment variable loading and log() helper
```

## How to Contribute

### Reporting Bugs

Use the [bug report template](.github/ISSUE_TEMPLATE/bug_report.yml). Include:
- Your OS and Android device model
- Whether you are using USB or WiFi ADB
- Whether scrcpy streaming is enabled
- The full error output

### Suggesting Features

Use the [feature request template](.github/ISSUE_TEMPLATE/feature_request.yml). Check [open issues](https://github.com/ismail-kattakath/mcp-android/issues) first.

### Versioning

We use `@changesets/cli`. When you create a PR that should trigger a version bump, run `npx changeset` and follow the prompts.

### Pull Requests

1. Fork the repository and create a branch from `main`
2. Make your changes with clear, focused commits
3. Run `npm run typecheck` — no type errors allowed
4. Run `npm run build` — must compile cleanly
5. Test against a real device if possible
6. Run `npx changeset` if your changes affect behaviour or the public API
7. Open a PR against `main`

#### Commit Message Style

Use conventional commits:
- `feat: add android.screen.record tool`
- `fix: handle adb disconnect during screencap`
- `docs: add WiFi ADB setup guide`
- `chore: bump @modelcontextprotocol/sdk to 1.26`

### Adding a New Tool

1. Add the underlying ADB function to `src/adb.ts`
2. Register the tool in `src/index.ts` using `server.registerTool()`
3. Follow the naming convention: `android.<category>.<action>`
4. Include a thorough `description` — this is what the AI sees
5. Use Zod `.strict()` schemas with `.describe()` on every field
6. Update the tool count in `README.md` and `src/index.ts`

## Code Style

- TypeScript strict mode is required
- No `any` without explicit justification
- No comments explaining _what_ code does — only _why_ when non-obvious
- Prefer `async/await` over raw Promises
- Module imports use `.js` extensions (NodeNext resolution)

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
