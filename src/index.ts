import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

import { loadConfig, log } from "./config.js";
import {
  configureAdbConnection,
  listDevices, getDeviceProps,
  tap, swipe, inputText, keyevent,
  startApp, stopApp,
  screencapPng, dumpUiHierarchy,
  longPress, pinch, dragDrop,
  shellCommand, pushFile, pullFile, listDirectory,
  getClipboard, setClipboard,
  listInstalledApps, getNotifications, getCurrentActivity,
  wakeScreen, sleepScreen, isScreenOn, unlockScreen,
  connectWifi, disconnectWifi, enableTcpip, getDeviceIp,
  installApk, getLogcat, activityManagerCommand, packageManagerCommand,
} from "./adb.js";
import { ScrcpySession } from "./scrcpySession.js";

type SessionEntry = {
  session: ScrcpySession;
  resourceHandle?: { remove: () => void };
};

const cfg = loadConfig();
const lvl = cfg.logLevel;

// Route adb through the host's adb daemon when running inside Docker MCP gateway.
// Set ADB_SERVER_HOST=host.docker.internal + ADB_SERVER_PORT=5037 in the profile env.
if (cfg.adbServerHost) {
  configureAdbConnection(cfg.adbServerHost, cfg.adbServerPort ?? 5037);
}

const server = new McpServer({
  name: "mcp-android",
  version: "1.0.0",
});

const sessionsBySerial = new Map<string, SessionEntry>();

function requireStreamingDeps() {
  if (!cfg.scrcpyServerPath || !cfg.scrcpyServerVersion) {
    throw new Error("Streaming requires SCRCPY_SERVER_PATH and SCRCPY_SERVER_VERSION env vars.");
  }
}

function base64(buf: Buffer): string {
  return buf.toString("base64");
}

function safeJson(obj: unknown): string {
  try { return JSON.stringify(obj, null, 2); } catch { return String(obj); }
}

function sendResourceUpdated(uri: string) {
  const proto = (server as any).server;
  if (proto?.sendResourceUpdated) {
    proto.sendResourceUpdated({ uri });
  } else if (proto?.notification) {
    proto.notification({ method: "notifications/resources/updated", params: { uri } });
  }
}

// ---- Resources ----

server.registerResource(
  "android-devices",
  "android://devices",
  { title: "Connected Android devices", description: "List of devices from adb devices -l", mimeType: "application/json" },
  async () => {
    const devices = await listDevices(cfg.adbPath);
    return { contents: [{ uri: "android://devices", mimeType: "application/json", text: safeJson({ devices }) }] };
  }
);

// ---- Device Tools ----

server.registerTool(
  "android.devices.list",
  {
    title: "List connected Android devices",
    description: "Returns the output of adb devices -l (parsed). Lists all connected devices and emulators with their serial numbers, state, model, and product info.",
    inputSchema: z.object({}).strict(),
  },
  async () => {
    const devices = await listDevices(cfg.adbPath);
    log(lvl, "INFO", `Listed ${devices.length} device(s)`);
    return { content: [{ type: "text", text: safeJson({ devices }) }], structuredContent: { devices } };
  }
);

server.registerTool(
  "android.devices.info",
  {
    title: "Get device info via getprop",
    description: "Returns key device properties (model, brand, manufacturer, SDK version, OS release) for a specific device serial.",
    inputSchema: z.object({ serial: z.string().min(1).describe("Device serial number") }).strict(),
  },
  async ({ serial }) => {
    const props = await getDeviceProps(cfg.adbPath, serial);
    const pick = (k: string) => props[k];
    const info = {
      serial,
      model: pick("ro.product.model"),
      brand: pick("ro.product.brand"),
      manufacturer: pick("ro.product.manufacturer"),
      device: pick("ro.product.device"),
      sdk: pick("ro.build.version.sdk"),
      release: pick("ro.build.version.release"),
    };
    return { content: [{ type: "text", text: safeJson(info) }], structuredContent: info };
  }
);

// ---- Vision Tools ----

server.registerTool(
  "android.vision.startStream",
  {
    title: "Start a continuous H.264 vision stream",
    description: "Uses scrcpy standalone server + ffmpeg to stream device screen. Creates a live JPEG resource at android://device/<serial>/frame/latest.jpg. Also enables fast input via the scrcpy control protocol (~5ms vs ~100ms for adb shell). Requires SCRCPY_SERVER_PATH and SCRCPY_SERVER_VERSION env vars.",
    inputSchema: z.object({
      serial: z.string().min(1).describe("Device serial number"),
      maxSize: z.number().int().positive().optional().describe("Max screen dimension (default: 1024)"),
      maxFps: z.number().int().positive().optional().describe("Stream FPS (default: 30)"),
      frameFps: z.number().int().positive().optional().describe("JPEG extraction FPS (default: 2)"),
    }).strict(),
  },
  async ({ serial, maxSize, maxFps, frameFps }) => {
    requireStreamingDeps();

    if (sessionsBySerial.has(serial)) {
      const entry = sessionsBySerial.get(serial)!;
      const health = await entry.session.health();
      const out = { status: "already_running", serial, resourceUri: entry.session.resourceUri, health };
      return { content: [{ type: "text", text: safeJson(out) }], structuredContent: out };
    }

    const sessionId = `${serial}-${Date.now()}`;
    const session = new ScrcpySession(serial, sessionId, {
      adbPath: cfg.adbPath,
      ffmpegPath: cfg.ffmpegPath,
      scrcpyServerPath: cfg.scrcpyServerPath!,
      scrcpyServerVersion: cfg.scrcpyServerVersion!,
      maxSize: maxSize ?? cfg.defaultMaxSize,
      maxFps: maxFps ?? cfg.defaultMaxFps,
      frameFps: frameFps ?? cfg.defaultFrameFps,
      socketPrefix: cfg.scrcpySocketPrefix,
      rawStreamArg: cfg.rawStreamArg,
    });

    const frameUri = session.resourceUri;

    const resourceHandle = server.registerResource(
      `android-frame-${serial}`,
      frameUri,
      { title: `Latest frame (${serial})`, description: `Live JPEG frame for device ${serial}`, mimeType: "image/jpeg" },
      async () => {
        const latest = sessionsBySerial.get(serial)?.session.latest;
        if (!latest) {
          return { contents: [{ uri: frameUri, mimeType: "text/plain", text: "No frame available yet (stream starting)." }] };
        }
        return { contents: [{ uri: frameUri, mimeType: "image/jpeg", blob: base64(latest.jpeg) }] };
      }
    );

    sessionsBySerial.set(serial, { session, resourceHandle });

    session.onFrame(() => {
      sendResourceUpdated(frameUri);
    });

    await session.start();
    log(lvl, "INFO", `Stream started for ${serial}`);

    const out = {
      status: "started", serial, sessionId, resourceUri: frameUri,
      note: "Read the resource to get the latest frame. Fast input via scrcpy control protocol is now active.",
    };
    return { content: [{ type: "text", text: safeJson(out) }], structuredContent: out };
  }
);

server.registerTool(
  "android.vision.stopStream",
  {
    title: "Stop an active vision stream",
    description: "Stops the scrcpy + ffmpeg pipeline and removes the frame resource. Fast input falls back to adb shell after stopping.",
    inputSchema: z.object({ serial: z.string().min(1) }).strict(),
  },
  async ({ serial }) => {
    const entry = sessionsBySerial.get(serial);
    if (!entry) {
      return { content: [{ type: "text", text: safeJson({ status: "not_running", serial }) }], structuredContent: { status: "not_running", serial } };
    }
    await entry.session.stop();
    entry.resourceHandle?.remove();
    sessionsBySerial.delete(serial);
    log(lvl, "INFO", `Stream stopped for ${serial}`);
    return { content: [{ type: "text", text: safeJson({ status: "stopped", serial }) }], structuredContent: { status: "stopped", serial } };
  }
);

server.registerTool(
  "android.vision.snapshot",
  {
    title: "Take a screenshot (PNG) from a device",
    description: "Uses adb exec-out screencap -p. Works without scrcpy/ffmpeg. Returns image/png as base64.",
    inputSchema: z.object({ serial: z.string().min(1) }).strict(),
  },
  async ({ serial }) => {
    const png = await screencapPng(cfg.adbPath, serial);
    return { content: [{ type: "image", mimeType: "image/png", data: base64(png) }] };
  }
);

// ---- Input Tools ----

server.registerTool(
  "android.input.tap",
  {
    title: "Tap on the device screen",
    description: "Taps at coordinates (x,y). Uses fast scrcpy control protocol (~5ms) when stream is active, otherwise falls back to adb shell input (~100-300ms).",
    inputSchema: z.object({
      serial: z.string().min(1),
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
    }).strict(),
  },
  async ({ serial, x, y }) => {
    const entry = sessionsBySerial.get(serial);
    if (entry?.session.controlReady) {
      const success = entry.session.fastTap(x, y);
      if (success) return { content: [{ type: "text", text: `Fast tapped ${x},${y} on ${serial} (via scrcpy)` }] };
    }
    await tap(cfg.adbPath, serial, x, y);
    return { content: [{ type: "text", text: `Tapped ${x},${y} on ${serial}` }] };
  }
);

server.registerTool(
  "android.input.swipe",
  {
    title: "Swipe on the device screen",
    description: "Swipes from (x1,y1) to (x2,y2). Uses fast scrcpy control protocol when stream is active, otherwise falls back to adb shell input.",
    inputSchema: z.object({
      serial: z.string().min(1),
      x1: z.number().int().nonnegative(),
      y1: z.number().int().nonnegative(),
      x2: z.number().int().nonnegative(),
      y2: z.number().int().nonnegative(),
      durationMs: z.number().int().nonnegative().default(300),
    }).strict(),
  },
  async ({ serial, x1, y1, x2, y2, durationMs }) => {
    const entry = sessionsBySerial.get(serial);
    if (entry?.session.controlReady) {
      const steps = Math.max(10, Math.min(50, Math.floor(durationMs / 10)));
      const delayMs = durationMs / steps;
      const success = await entry.session.fastSwipe(x1, y1, x2, y2, steps, delayMs);
      if (success) return { content: [{ type: "text", text: `Fast swiped (${x1},${y1})->(${x2},${y2}) on ${serial} (via scrcpy)` }] };
    }
    await swipe(cfg.adbPath, serial, x1, y1, x2, y2, durationMs);
    return { content: [{ type: "text", text: `Swiped (${x1},${y1})->(${x2},${y2}) on ${serial} (${durationMs}ms)` }] };
  }
);

server.registerTool(
  "android.input.text",
  {
    title: "Type text on the device",
    description: "Types text. Uses fast scrcpy text injection when stream is active (instant, full UTF-8), otherwise falls back to adb shell input text (slower, spaces encoded as %s).",
    inputSchema: z.object({
      serial: z.string().min(1),
      text: z.string().min(1),
    }).strict(),
  },
  async ({ serial, text }) => {
    const entry = sessionsBySerial.get(serial);
    if (entry?.session.controlReady) {
      const success = entry.session.fastText(text);
      if (success) return { content: [{ type: "text", text: `Fast typed text on ${serial} (via scrcpy)` }] };
    }
    await inputText(cfg.adbPath, serial, text);
    return { content: [{ type: "text", text: `Typed text on ${serial}` }] };
  }
);

server.registerTool(
  "android.input.keyevent",
  {
    title: "Send a keyevent on the device",
    description: "Sends a keycode event. Uses fast scrcpy control protocol when stream is active. Common keycodes: HOME=3, BACK=4, VOLUME_UP=24, VOLUME_DOWN=25, POWER=26, ENTER=66, DELETE=67, WAKEUP=224.",
    inputSchema: z.object({
      serial: z.string().min(1),
      keycode: z.number().int().nonnegative().describe("Android keycode integer"),
    }).strict(),
  },
  async ({ serial, keycode }) => {
    const entry = sessionsBySerial.get(serial);
    if (entry?.session.controlReady) {
      const success = entry.session.fastKey(keycode);
      if (success) return { content: [{ type: "text", text: `Fast sent keyevent ${keycode} on ${serial} (via scrcpy)` }] };
    }
    await keyevent(cfg.adbPath, serial, keycode);
    return { content: [{ type: "text", text: `Sent keyevent ${keycode} on ${serial}` }] };
  }
);

server.registerTool(
  "android.input.longPress",
  {
    title: "Long press on the device screen",
    description: "Performs a long press at coordinates (x,y) for specified duration. Uses fast scrcpy control protocol when stream is active.",
    inputSchema: z.object({
      serial: z.string().min(1),
      x: z.number().int().nonnegative(),
      y: z.number().int().nonnegative(),
      durationMs: z.number().int().positive().default(1000),
    }).strict(),
  },
  async ({ serial, x, y, durationMs }) => {
    const entry = sessionsBySerial.get(serial);
    if (entry?.session.controlReady) {
      const success = await entry.session.fastLongPress(x, y, durationMs);
      if (success) return { content: [{ type: "text", text: `Fast long pressed at ${x},${y} on ${serial} for ${durationMs}ms (via scrcpy)` }] };
    }
    await longPress(cfg.adbPath, serial, x, y, durationMs);
    return { content: [{ type: "text", text: `Long pressed at ${x},${y} on ${serial} for ${durationMs}ms` }] };
  }
);

server.registerTool(
  "android.input.pinch",
  {
    title: "Pinch gesture (zoom in/out)",
    description: "Simulates a pinch gesture at center point. Pinch in: startDistance > endDistance. Pinch out: startDistance < endDistance. Note: Single-finger swipe simulation; true multi-touch requires scrcpy streaming mode.",
    inputSchema: z.object({
      serial: z.string().min(1),
      centerX: z.number().int().nonnegative(),
      centerY: z.number().int().nonnegative(),
      startDistance: z.number().int().positive(),
      endDistance: z.number().int().positive(),
      durationMs: z.number().int().positive().default(500),
    }).strict(),
  },
  async ({ serial, centerX, centerY, startDistance, endDistance, durationMs }) => {
    await pinch(cfg.adbPath, serial, centerX, centerY, startDistance, endDistance, durationMs);
    const direction = startDistance > endDistance ? "in" : "out";
    return { content: [{ type: "text", text: `Pinch ${direction} at (${centerX},${centerY}) on ${serial} (${startDistance}→${endDistance}px, ${durationMs}ms)` }] };
  }
);

server.registerTool(
  "android.input.dragDrop",
  {
    title: "Drag and drop gesture",
    description: "Drags from start coordinates to end coordinates. Uses adb shell input draganddrop on Android 7+, falls back to swipe on older versions.",
    inputSchema: z.object({
      serial: z.string().min(1),
      startX: z.number().int().nonnegative(),
      startY: z.number().int().nonnegative(),
      endX: z.number().int().nonnegative(),
      endY: z.number().int().nonnegative(),
      durationMs: z.number().int().positive().default(500),
    }).strict(),
  },
  async ({ serial, startX, startY, endX, endY, durationMs }) => {
    await dragDrop(cfg.adbPath, serial, startX, startY, endX, endY, durationMs);
    return { content: [{ type: "text", text: `Dragged from (${startX},${startY}) to (${endX},${endY}) on ${serial} (${durationMs}ms)` }] };
  }
);

// ---- UI Tools ----

server.registerTool(
  "android.ui.dump",
  {
    title: "Dump UI hierarchy",
    description: "Dumps the current UI hierarchy using uiautomator. Returns XML with all visible elements, their bounds [left,top][right,bottom], text, resource-id, content-desc, and class. Useful for finding tap targets.",
    inputSchema: z.object({ serial: z.string().min(1) }).strict(),
  },
  async ({ serial }) => {
    const xml = await dumpUiHierarchy(cfg.adbPath, serial);
    return { content: [{ type: "text", text: xml }] };
  }
);

server.registerTool(
  "android.ui.findElement",
  {
    title: "Find UI elements with filters",
    description: "Finds UI elements in the current screen by text, resource-id, class, or content-desc. Returns matching elements with their center coordinates for easy tapping.",
    inputSchema: z.object({
      serial: z.string().min(1),
      text: z.string().optional().describe("Filter by element text (partial match)"),
      resourceId: z.string().optional().describe("Filter by resource-id (partial match)"),
      className: z.string().optional().describe("Filter by class name (partial match)"),
      contentDesc: z.string().optional().describe("Filter by content-description (partial match)"),
    }).strict(),
  },
  async ({ serial, text, resourceId, className, contentDesc }) => {
    const xml = await dumpUiHierarchy(cfg.adbPath, serial);

    const elements: Array<{
      text?: string; resourceId?: string; className?: string;
      contentDesc?: string; bounds: string; centerX: number; centerY: number;
    }> = [];

    const nodeRegex = /<node[^>]*>/g;
    const matches = xml.matchAll(nodeRegex);

    for (const match of matches) {
      const nodeStr = match[0];
      const getAttr = (name: string) => {
        const regex = new RegExp(`${name}="([^"]*)"`, 'i');
        const m = nodeStr.match(regex);
        return m ? m[1] : undefined;
      };

      const nodeText = getAttr("text");
      const nodeResourceId = getAttr("resource-id");
      const nodeClassName = getAttr("class");
      const nodeContentDesc = getAttr("content-desc");
      const nodeBounds = getAttr("bounds");

      if (text && (!nodeText || !nodeText.includes(text))) continue;
      if (resourceId && (!nodeResourceId || !nodeResourceId.includes(resourceId))) continue;
      if (className && (!nodeClassName || !nodeClassName.includes(className))) continue;
      if (contentDesc && (!nodeContentDesc || !nodeContentDesc.includes(contentDesc))) continue;

      if (nodeBounds) {
        const boundsMatch = nodeBounds.match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
        if (boundsMatch) {
          const left = parseInt(boundsMatch[1]);
          const top = parseInt(boundsMatch[2]);
          const right = parseInt(boundsMatch[3]);
          const bottom = parseInt(boundsMatch[4]);
          elements.push({
            text: nodeText, resourceId: nodeResourceId, className: nodeClassName,
            contentDesc: nodeContentDesc, bounds: nodeBounds,
            centerX: Math.floor((left + right) / 2),
            centerY: Math.floor((top + bottom) / 2),
          });
        }
      }
    }

    return {
      content: [{ type: "text", text: safeJson({ matchCount: elements.length, elements }) }],
      structuredContent: { matchCount: elements.length, elements },
    };
  }
);

// ---- App Tools ----

server.registerTool(
  "android.app.start",
  {
    title: "Start an app",
    description: "Starts an Android app by package name (optionally with specific activity). Tries monkey launcher first, falls back to am start.",
    inputSchema: z.object({
      serial: z.string().min(1),
      packageName: z.string().min(1).describe("App package name e.g. com.android.settings"),
      activity: z.string().optional().describe("Specific activity to launch e.g. .MainActivity"),
    }).strict(),
  },
  async ({ serial, packageName, activity }) => {
    await startApp(cfg.adbPath, serial, packageName, activity);
    return { content: [{ type: "text", text: `Started ${packageName} on ${serial}` }] };
  }
);

server.registerTool(
  "android.app.stop",
  {
    title: "Force-stop an app",
    description: "Force-stops an Android app by package name using am force-stop.",
    inputSchema: z.object({
      serial: z.string().min(1),
      packageName: z.string().min(1).describe("App package name to stop"),
    }).strict(),
  },
  async ({ serial, packageName }) => {
    await stopApp(cfg.adbPath, serial, packageName);
    return { content: [{ type: "text", text: `Stopped ${packageName} on ${serial}` }] };
  }
);

server.registerTool(
  "android.app.install",
  {
    title: "Install an APK on device",
    description: "Installs an Android application (APK) from a local file path using adb install -r. Automatically replaces existing installations.",
    inputSchema: z.object({
      serial: z.string().min(1).describe("Device serial number"),
      apkPath: z.string().min(1).describe("Local file path to the APK file"),
    }).strict(),
  },
  async ({ serial, apkPath }) => {
    log(lvl, "INFO", `Installing APK ${apkPath} on ${serial}`);
    const result = await installApk(cfg.adbPath, serial, apkPath);
    return { content: [{ type: "text", text: result }] };
  }
);

server.registerTool(
  "android.apps.list",
  {
    title: "List installed apps on device",
    description: "Lists installed packages using pm list packages. Set system=true for system-only, system=false for third-party only, or omit for all.",
    inputSchema: z.object({
      serial: z.string().min(1),
      system: z.boolean().optional().describe("true=system only, false=third-party only, omit=all"),
    }).strict(),
  },
  async ({ serial, system }) => {
    const packages = await listInstalledApps(cfg.adbPath, serial, { system });
    const filter = system === true ? "system only" : system === false ? "third-party only" : "all";
    return {
      content: [{ type: "text", text: safeJson({ count: packages.length, filter, packages }) }],
      structuredContent: { count: packages.length, filter, packages },
    };
  }
);

server.registerTool(
  "android.activity.current",
  {
    title: "Get current foreground activity",
    description: "Retrieves the currently focused package and activity name. Useful for determining which app is in the foreground.",
    inputSchema: z.object({ serial: z.string().min(1) }).strict(),
  },
  async ({ serial }) => {
    const activity = await getCurrentActivity(cfg.adbPath, serial);
    return { content: [{ type: "text", text: safeJson(activity) }], structuredContent: activity };
  }
);

// ---- System Tools ----

server.registerTool(
  "android.shell.exec",
  {
    title: "Execute shell command on device",
    description: "WARNING: Executes arbitrary shell command via adb shell. Can perform any operation on the device. Returns stdout, stderr, and exit code.",
    inputSchema: z.object({
      serial: z.string().min(1),
      command: z.string().min(1).describe("Shell command to execute"),
    }).strict(),
  },
  async ({ serial, command }) => {
    const result = await shellCommand(cfg.adbPath, serial, command);
    return {
      content: [{ type: "text", text: safeJson({ command, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr }) }],
      structuredContent: { command, exitCode: result.exitCode, stdout: result.stdout, stderr: result.stderr },
    };
  }
);

server.registerTool(
  "android.system.logcat",
  {
    title: "Get device logcat output",
    description: "Retrieves Android system and application logs. Supports filtering by log tags or expressions. Returns the last N lines (default 50).",
    inputSchema: z.object({
      serial: z.string().min(1),
      lines: z.number().int().positive().default(50).describe("Number of lines to return (default: 50)"),
      filter: z.string().optional().describe("Logcat filter expression e.g. 'MyTag:D *:S'"),
    }).strict(),
  },
  async ({ serial, lines, filter }) => {
    log(lvl, "INFO", `Getting logcat for ${serial} (${lines} lines, filter: ${filter ?? "none"})`);
    const output = await getLogcat(cfg.adbPath, serial, { lines, filter });
    return { content: [{ type: "text", text: output }] };
  }
);

server.registerTool(
  "android.system.activityManager",
  {
    title: "Run Activity Manager (am) command",
    description: "Executes Activity Manager commands on the device. Supports: start, broadcast, force-stop, instrument, profile, dumpheap, etc. Example: amCommand='start', amArgs='-a android.intent.action.VIEW -d http://example.com'",
    inputSchema: z.object({
      serial: z.string().min(1),
      amCommand: z.string().min(1).describe("am subcommand: start, broadcast, force-stop, etc."),
      amArgs: z.string().optional().describe("Arguments for the am subcommand"),
    }).strict(),
  },
  async ({ serial, amCommand, amArgs }) => {
    log(lvl, "INFO", `am ${amCommand} ${amArgs ?? ""} on ${serial}`);
    const result = await activityManagerCommand(cfg.adbPath, serial, amCommand, amArgs);
    return { content: [{ type: "text", text: result }] };
  }
);

server.registerTool(
  "android.system.packageManager",
  {
    title: "Run Package Manager (pm) command",
    description: "Executes Package Manager commands on the device. Supports: list, install, uninstall, grant, revoke, clear, enable, disable, etc. Example: pmCommand='list', pmArgs='packages -3' (lists third-party packages).",
    inputSchema: z.object({
      serial: z.string().min(1),
      pmCommand: z.string().min(1).describe("pm subcommand: list, grant, revoke, clear, enable, disable, uninstall, etc."),
      pmArgs: z.string().optional().describe("Arguments for the pm subcommand"),
    }).strict(),
  },
  async ({ serial, pmCommand, pmArgs }) => {
    log(lvl, "INFO", `pm ${pmCommand} ${pmArgs ?? ""} on ${serial}`);
    const result = await packageManagerCommand(cfg.adbPath, serial, pmCommand, pmArgs);
    return { content: [{ type: "text", text: result }] };
  }
);

// ---- File Tools ----

server.registerTool(
  "android.file.push",
  {
    title: "Push file to device",
    description: "WARNING: Transfers a local file to the device filesystem using adb push. Local path must exist; remote path must be writable.",
    inputSchema: z.object({
      serial: z.string().min(1),
      localPath: z.string().min(1).describe("Local file path on the host"),
      remotePath: z.string().min(1).describe("Destination path on the device"),
    }).strict(),
  },
  async ({ serial, localPath, remotePath }) => {
    await pushFile(cfg.adbPath, serial, localPath, remotePath);
    return { content: [{ type: "text", text: `Successfully pushed ${localPath} to ${remotePath} on device ${serial}` }] };
  }
);

server.registerTool(
  "android.file.pull",
  {
    title: "Pull file from device",
    description: "Transfers a file from the device to the local filesystem using adb pull.",
    inputSchema: z.object({
      serial: z.string().min(1),
      remotePath: z.string().min(1).describe("Source path on the device"),
      localPath: z.string().min(1).describe("Destination path on the host"),
    }).strict(),
  },
  async ({ serial, remotePath, localPath }) => {
    await pullFile(cfg.adbPath, serial, remotePath, localPath);
    return { content: [{ type: "text", text: `Successfully pulled ${remotePath} from device ${serial} to ${localPath}` }] };
  }
);

server.registerTool(
  "android.file.list",
  {
    title: "List directory contents on device",
    description: "Lists files and directories on the device using adb shell ls -la. Returns permissions, ownership, size, and modification time.",
    inputSchema: z.object({
      serial: z.string().min(1),
      path: z.string().min(1).describe("Directory path on the device"),
    }).strict(),
  },
  async ({ serial, path }) => {
    const listing = await listDirectory(cfg.adbPath, serial, path);
    return { content: [{ type: "text", text: listing }] };
  }
);

// ---- Clipboard Tools ----

server.registerTool(
  "android.clipboard.get",
  {
    title: "Get clipboard content from device",
    description: "Retrieves current clipboard content via dumpsys clipboard. May have limitations on Android 10+ due to privacy restrictions.",
    inputSchema: z.object({ serial: z.string().min(1) }).strict(),
  },
  async ({ serial }) => {
    const clipboardText = await getClipboard(cfg.adbPath, serial);
    return {
      content: [{ type: "text", text: clipboardText || "(clipboard is empty)" }],
      structuredContent: { clipboardText },
    };
  }
);

server.registerTool(
  "android.clipboard.set",
  {
    title: "Set clipboard content on device",
    description: "Attempts to set clipboard content via ADB broadcast. WARNING: Direct clipboard setting is restricted on most Android 10+ devices. Consider using UI automation to paste instead.",
    inputSchema: z.object({
      serial: z.string().min(1),
      text: z.string().min(1).describe("Text to set as clipboard content"),
    }).strict(),
  },
  async ({ serial, text }) => {
    await setClipboard(cfg.adbPath, serial, text);
    return { content: [{ type: "text", text: `Attempted to set clipboard on ${serial}. Note: May not work on all devices due to security restrictions.` }] };
  }
);

// ---- Notification Tools ----

server.registerTool(
  "android.notifications.get",
  {
    title: "Get current notifications from device",
    description: "Dumps all current notifications via dumpsys notification --noredact. Returns notification text, package names, and metadata.",
    inputSchema: z.object({ serial: z.string().min(1) }).strict(),
  },
  async ({ serial }) => {
    const notificationDump = await getNotifications(cfg.adbPath, serial);
    return { content: [{ type: "text", text: notificationDump }] };
  }
);

// ---- Screen Tools ----

server.registerTool(
  "android.screen.wake",
  {
    title: "Wake device screen",
    description: "Wakes the device screen using KEYCODE_WAKEUP (224).",
    inputSchema: z.object({ serial: z.string().min(1) }).strict(),
  },
  async ({ serial }) => {
    await wakeScreen(cfg.adbPath, serial);
    return { content: [{ type: "text", text: `Screen woken on device ${serial}` }] };
  }
);

server.registerTool(
  "android.screen.sleep",
  {
    title: "Put device screen to sleep",
    description: "Puts the device screen to sleep using KEYCODE_SLEEP (223).",
    inputSchema: z.object({ serial: z.string().min(1) }).strict(),
  },
  async ({ serial }) => {
    await sleepScreen(cfg.adbPath, serial);
    return { content: [{ type: "text", text: `Screen put to sleep on device ${serial}` }] };
  }
);

server.registerTool(
  "android.screen.isOn",
  {
    title: "Check if device screen is on",
    description: "Checks screen state via dumpsys power/display. Returns true if on, false if off.",
    inputSchema: z.object({ serial: z.string().min(1) }).strict(),
  },
  async ({ serial }) => {
    const screenOn = await isScreenOn(cfg.adbPath, serial);
    return {
      content: [{ type: "text", text: safeJson({ serial, screenOn }) }],
      structuredContent: { serial, screenOn },
    };
  }
);

server.registerTool(
  "android.screen.unlock",
  {
    title: "Unlock device screen",
    description: "Wakes the screen and attempts to unlock using KEYCODE_MENU (82) or swipe. WARNING: Only works for devices without a secure lock (no PIN/password/pattern).",
    inputSchema: z.object({ serial: z.string().min(1) }).strict(),
  },
  async ({ serial }) => {
    await unlockScreen(cfg.adbPath, serial);
    return { content: [{ type: "text", text: `Screen unlocked on device ${serial}. Only works for devices without secure lock.` }] };
  }
);

// ---- WiFi ADB Tools ----

server.registerTool(
  "android.adb.connectWifi",
  {
    title: "Connect to device via WiFi",
    description: "Connects to an Android device over WiFi. Device must have TCP/IP mode enabled first (use android.adb.enableTcpip while connected via USB). Use android.adb.getDeviceIp to get the IP.",
    inputSchema: z.object({
      ipAddress: z.string().min(7).describe("Device IP address e.g. 192.168.1.100"),
      port: z.number().int().positive().default(5555).describe("ADB TCP port (default: 5555)"),
    }).strict(),
  },
  async ({ ipAddress, port }) => {
    await connectWifi(cfg.adbPath, ipAddress, port);
    return { content: [{ type: "text", text: `Connected to device at ${ipAddress}:${port}. Use ${ipAddress}:${port} as the serial for other commands.` }] };
  }
);

server.registerTool(
  "android.adb.disconnectWifi",
  {
    title: "Disconnect WiFi ADB connection",
    description: "Disconnects from a specific WiFi device or all WiFi devices if ipAddress is omitted.",
    inputSchema: z.object({
      ipAddress: z.string().optional().describe("Device IP to disconnect (omit to disconnect all WiFi devices)"),
    }).strict(),
  },
  async ({ ipAddress }) => {
    await disconnectWifi(cfg.adbPath, ipAddress);
    const message = ipAddress ? `Disconnected from device at ${ipAddress}` : "Disconnected from all WiFi devices";
    return { content: [{ type: "text", text: message }] };
  }
);

server.registerTool(
  "android.adb.enableTcpip",
  {
    title: "Enable TCP/IP mode for WiFi debugging",
    description: "Enables TCP/IP mode on the device (requires USB connection first). After enabling, use android.adb.getDeviceIp + android.adb.connectWifi to connect wirelessly.",
    inputSchema: z.object({
      serial: z.string().min(1).describe("Device serial (USB connection required)"),
      port: z.number().int().positive().default(5555).describe("TCP/IP port (default: 5555)"),
    }).strict(),
  },
  async ({ serial, port }) => {
    await enableTcpip(cfg.adbPath, serial, port);
    return { content: [{ type: "text", text: `TCP/IP mode enabled on device ${serial} port ${port}. Now use android.adb.getDeviceIp and android.adb.connectWifi.` }] };
  }
);

server.registerTool(
  "android.adb.getDeviceIp",
  {
    title: "Get device WiFi IP address",
    description: "Gets the device's WiFi IP address. Returns null if device is not on WiFi.",
    inputSchema: z.object({ serial: z.string().min(1) }).strict(),
  },
  async ({ serial }) => {
    const ipAddress = await getDeviceIp(cfg.adbPath, serial);
    if (ipAddress) {
      return {
        content: [{ type: "text", text: safeJson({ serial, ipAddress }) }],
        structuredContent: { serial, ipAddress },
      };
    }
    return {
      content: [{ type: "text", text: `Device ${serial} is not connected to WiFi or IP could not be determined.` }],
      structuredContent: { serial, ipAddress: null },
    };
  }
);

// ---- Startup ----

log(lvl, "INFO", "Starting mcp-android server...");

const transport = new StdioServerTransport();
await server.connect(transport);

log(lvl, "INFO", "mcp-android server connected and ready (37 tools)");

process.on("SIGINT", () => {
  for (const entry of sessionsBySerial.values()) {
    void entry.session.stop().catch(() => {});
    entry.resourceHandle?.remove();
  }
  process.exit(0);
});
