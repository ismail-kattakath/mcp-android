import { spawn, type ChildProcess } from "node:child_process";

// Prepended to every adb invocation when ADB_SERVER_HOST is set.
// Allows the containerized adb client to delegate to the host's adb daemon,
// which has USB access that Docker containers lack.
let _adbConnPrefix: string[] = [];

export function configureAdbConnection(host?: string, port?: number): void {
  _adbConnPrefix = [];
  if (host) _adbConnPrefix.push("-H", host);
  if (port) _adbConnPrefix.push("-P", String(port));
}

export type AdbDevice = {
  serial: string;
  state: string;
  model?: string;
  device?: string;
  transportId?: string;
  product?: string;
};

export type ExecResult = {
  code: number;
  stdout: string;
  stderr: string;
};

function collectOutput(proc: ReturnType<typeof spawn>): Promise<ExecResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    proc.stdout?.setEncoding("utf8");
    proc.stderr?.setEncoding("utf8");
    proc.stdout?.on("data", (d) => (stdout += d));
    proc.stderr?.on("data", (d) => (stderr += d));
    proc.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

export async function adbExec(
  adbPath: string,
  args: string[],
  opts?: { timeoutMs?: number }
): Promise<ExecResult> {
  const proc = spawn(adbPath, [..._adbConnPrefix, ...args], { stdio: ["ignore", "pipe", "pipe"] });
  const timeoutMs = opts?.timeoutMs ?? 0;
  let timeout: NodeJS.Timeout | undefined;

  const resultPromise = collectOutput(proc);

  if (timeoutMs > 0) {
    timeout = setTimeout(() => {
      try { proc.kill(); } catch { /* ignore */ }
    }, timeoutMs);
  }

  const result = await resultPromise;
  if (timeout) clearTimeout(timeout);
  return result;
}

export async function adbShell(
  adbPath: string,
  serial: string,
  shellArgs: string[]
): Promise<ExecResult> {
  return adbExec(adbPath, ["-s", serial, "shell", ...shellArgs]);
}

/**
 * Shell argument parser that handles single quotes, double quotes, and escape sequences.
 * Used for parsing activity/package manager argument strings.
 */
export function splitCommandArguments(value: string): string[] {
  const args: string[] = [];
  let current = "";
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escapeNext = false;

  for (const char of value) {
    if (escapeNext) {
      current += char;
      escapeNext = false;
      continue;
    }
    if (char === "\\") { escapeNext = true; continue; }
    if (char === "'" && !inDoubleQuote) { inSingleQuote = !inSingleQuote; continue; }
    if (char === '"' && !inSingleQuote) { inDoubleQuote = !inDoubleQuote; continue; }
    if (/\s/.test(char) && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) { args.push(current); current = ""; }
      continue;
    }
    current += char;
  }

  if (escapeNext) current += "\\";
  if (current.length > 0) args.push(current);
  return args;
}

export async function listDevices(adbPath: string): Promise<AdbDevice[]> {
  const res = await adbExec(adbPath, ["devices", "-l"]);
  if (res.code !== 0) throw new Error(`adb devices failed: ${res.stderr || res.stdout}`);

  const lines = res.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const out: AdbDevice[] = [];

  for (const line of lines) {
    if (line.toLowerCase().startsWith("list of devices")) continue;
    const parts = line.split(/\s+/);
    if (parts.length < 2) continue;
    const serial = parts[0];
    const state = parts[1];

    const kv: Record<string, string> = {};
    for (const p of parts.slice(2)) {
      const m = p.match(/^([^:]+):(.+)$/);
      if (m) kv[m[1]] = m[2];
    }

    out.push({ serial, state, model: kv.model, device: kv.device, transportId: kv.transport_id, product: kv.product });
  }
  return out;
}

export async function getDeviceProps(adbPath: string, serial: string): Promise<Record<string, string>> {
  const res = await adbShell(adbPath, serial, ["getprop"]);
  if (res.code !== 0) throw new Error(`adb shell getprop failed: ${res.stderr || res.stdout}`);

  const props: Record<string, string> = {};
  for (const line of res.stdout.split(/\r?\n/)) {
    const m = line.match(/^\[(.+?)\]: \[(.*)\]$/);
    if (m) props[m[1]] = m[2];
  }
  return props;
}

export async function tap(adbPath: string, serial: string, x: number, y: number): Promise<void> {
  const res = await adbShell(adbPath, serial, ["input", "tap", String(x), String(y)]);
  if (res.code !== 0) throw new Error(`tap failed: ${res.stderr || res.stdout}`);
}

export async function swipe(
  adbPath: string, serial: string,
  x1: number, y1: number, x2: number, y2: number, durationMs: number
): Promise<void> {
  const res = await adbShell(adbPath, serial, ["input", "swipe", String(x1), String(y1), String(x2), String(y2), String(durationMs)]);
  if (res.code !== 0) throw new Error(`swipe failed: ${res.stderr || res.stdout}`);
}

export async function inputText(adbPath: string, serial: string, text: string): Promise<void> {
  const safe = text.replace(/\r?\n/g, " ").split(" ").join("%s");
  const res = await adbShell(adbPath, serial, ["input", "text", safe]);
  if (res.code !== 0) throw new Error(`inputText failed: ${res.stderr || res.stdout}`);
}

export async function keyevent(adbPath: string, serial: string, keycode: number): Promise<void> {
  const res = await adbShell(adbPath, serial, ["input", "keyevent", String(keycode)]);
  if (res.code !== 0) throw new Error(`keyevent failed: ${res.stderr || res.stdout}`);
}

export async function startApp(adbPath: string, serial: string, pkg: string, activity?: string): Promise<void> {
  const component = activity ? `${pkg}/${activity}` : pkg;
  const res = await adbShell(adbPath, serial, ["monkey", "-p", pkg, "-c", "android.intent.category.LAUNCHER", "1"]);
  if (res.code !== 0) {
    const res2 = await adbShell(adbPath, serial, ["am", "start", "-n", component]);
    if (res2.code !== 0) throw new Error(`startApp failed: ${res2.stderr || res2.stdout}`);
  }
}

export async function stopApp(adbPath: string, serial: string, pkg: string): Promise<void> {
  const res = await adbShell(adbPath, serial, ["am", "force-stop", pkg]);
  if (res.code !== 0) throw new Error(`stopApp failed: ${res.stderr || res.stdout}`);
}

export async function screencapPng(adbPath: string, serial: string): Promise<Buffer> {
  const proc = spawn(adbPath, [..._adbConnPrefix, "-s", serial, "exec-out", "screencap", "-p"], { stdio: ["ignore", "pipe", "pipe"] });
  const chunks: Buffer[] = [];
  const errChunks: Buffer[] = [];
  proc.stdout?.on("data", (d) => chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
  proc.stderr?.on("data", (d) => errChunks.push(Buffer.isBuffer(d) ? d : Buffer.from(d)));
  const code: number = await new Promise((resolve) => proc.on("close", (c) => resolve(c ?? -1)));
  if (code !== 0) throw new Error(`screencap failed: ${Buffer.concat(errChunks).toString("utf8")}`);
  return Buffer.concat(chunks);
}

export async function dumpUiHierarchy(adbPath: string, serial: string): Promise<string> {
  const res = await adbShell(adbPath, serial, ["uiautomator", "dump", "/dev/tty"]);
  if (res.code !== 0) throw new Error(`uiautomator dump failed: ${res.stderr || res.stdout}`);
  return res.stdout;
}

export async function longPress(
  adbPath: string, serial: string, x: number, y: number, durationMs: number = 1000
): Promise<void> {
  const res = await adbShell(adbPath, serial, ["input", "swipe", String(x), String(y), String(x), String(y), String(durationMs)]);
  if (res.code !== 0) throw new Error(`longPress failed: ${res.stderr || res.stdout}`);
}

export async function pinch(
  adbPath: string, serial: string,
  centerX: number, centerY: number, startDistance: number, endDistance: number, durationMs: number = 500
): Promise<void> {
  const startX = centerX - Math.floor(startDistance / 2);
  const endX = centerX - Math.floor(endDistance / 2);
  const res = await adbShell(adbPath, serial, ["input", "swipe", String(startX), String(centerY), String(endX), String(centerY), String(durationMs)]);
  if (res.code !== 0) throw new Error(`pinch failed: ${res.stderr || res.stdout}`);
}

export async function dragDrop(
  adbPath: string, serial: string,
  startX: number, startY: number, endX: number, endY: number, durationMs: number = 500
): Promise<void> {
  let res = await adbShell(adbPath, serial, ["input", "draganddrop", String(startX), String(startY), String(endX), String(endY)]);
  if (res.code !== 0 && res.stderr.includes("Unknown command")) {
    res = await adbShell(adbPath, serial, ["input", "swipe", String(startX), String(startY), String(endX), String(endY), String(durationMs)]);
  }
  if (res.code !== 0) throw new Error(`dragDrop failed: ${res.stderr || res.stdout}`);
}

export async function shellCommand(
  adbPath: string, serial: string, command: string
): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const res = await adbShell(adbPath, serial, [command]);
  return { stdout: res.stdout, stderr: res.stderr, exitCode: res.code };
}

export async function pushFile(adbPath: string, serial: string, localPath: string, remotePath: string): Promise<void> {
  const res = await adbExec(adbPath, ["-s", serial, "push", localPath, remotePath]);
  if (res.code !== 0) throw new Error(`pushFile failed: ${res.stderr || res.stdout}`);
}

export async function pullFile(adbPath: string, serial: string, remotePath: string, localPath: string): Promise<void> {
  const res = await adbExec(adbPath, ["-s", serial, "pull", remotePath, localPath]);
  if (res.code !== 0) throw new Error(`pullFile failed: ${res.stderr || res.stdout}`);
}

export async function listDirectory(adbPath: string, serial: string, path: string): Promise<string> {
  const res = await adbShell(adbPath, serial, ["ls", "-la", path]);
  if (res.code !== 0) throw new Error(`listDirectory failed: ${res.stderr || res.stdout}`);
  return res.stdout;
}

export async function getClipboard(adbPath: string, serial: string): Promise<string> {
  const res = await adbShell(adbPath, serial, ["dumpsys", "clipboard"]);
  if (res.code !== 0) throw new Error(`getClipboard failed: ${res.stderr || res.stdout}`);
  const output = res.stdout;
  const textMatch = output.match(/text="([^"]*)"/);
  if (textMatch) return textMatch[1];
  const itemMatch = output.match(/ClipData\.Item \{ T:([^}]*)\}/);
  if (itemMatch) return itemMatch[1].trim();
  if (output.includes("mPrimaryClip=null") || output.includes("primaryClip=null")) return "";
  return output;
}

export async function setClipboard(adbPath: string, serial: string, text: string): Promise<void> {
  const escaped = text.replace(/'/g, "'\\''");
  const res = await adbShell(adbPath, serial, ["am", "broadcast", "-a", "clipper.set", "-e", "text", `'${escaped}'`]);
  if (res.code !== 0 && !res.stderr.includes("BroadcastQueue")) {
    throw new Error(`setClipboard failed: Direct clipboard setting via ADB is restricted on most Android devices. Error: ${res.stderr || res.stdout}`);
  }
}

export async function listInstalledApps(
  adbPath: string, serial: string, options?: { system?: boolean }
): Promise<string[]> {
  const args = ["pm", "list", "packages"];
  if (options?.system === true) args.push("-s");
  else if (options?.system === false) args.push("-3");
  const res = await adbShell(adbPath, serial, args);
  if (res.code !== 0) throw new Error(`listInstalledApps failed: ${res.stderr || res.stdout}`);
  const packages: string[] = [];
  for (const line of res.stdout.split(/\r?\n/)) {
    const match = line.match(/^package:(.+)$/);
    if (match) packages.push(match[1].trim());
  }
  return packages;
}

export async function getNotifications(adbPath: string, serial: string): Promise<string> {
  const res = await adbShell(adbPath, serial, ["dumpsys", "notification", "--noredact"]);
  if (res.code !== 0) throw new Error(`getNotifications failed: ${res.stderr || res.stdout}`);
  return res.stdout;
}

export async function getCurrentActivity(adbPath: string, serial: string): Promise<{ package: string; activity: string }> {
  let res = await adbShell(adbPath, serial, ["dumpsys", "activity", "activities"]);
  if (res.code === 0) {
    const resumedMatch = res.stdout.match(/mResumedActivity:.*?(\S+)\/(\S+)\s/);
    if (resumedMatch) return { package: resumedMatch[1], activity: resumedMatch[2] };
  }
  res = await adbShell(adbPath, serial, ["dumpsys", "window", "windows"]);
  if (res.code !== 0) throw new Error(`getCurrentActivity failed: ${res.stderr || res.stdout}`);
  const focusMatch = res.stdout.match(/mCurrentFocus=Window\{[^}]+\s+(\S+)\/(\S+)\}/);
  if (focusMatch) return { package: focusMatch[1], activity: focusMatch[2] };
  const altMatch = res.stdout.match(/mFocusedApp=.*?ActivityRecord\{.*?\s+(\S+)\/(\S+)\s/);
  if (altMatch) return { package: altMatch[1], activity: altMatch[2] };
  throw new Error("Could not determine current activity. Device may be on home screen or lock screen.");
}

export async function wakeScreen(adbPath: string, serial: string): Promise<void> {
  const res = await adbShell(adbPath, serial, ["input", "keyevent", "224"]);
  if (res.code !== 0) throw new Error(`wakeScreen failed: ${res.stderr || res.stdout}`);
}

export async function sleepScreen(adbPath: string, serial: string): Promise<void> {
  const res = await adbShell(adbPath, serial, ["input", "keyevent", "223"]);
  if (res.code !== 0) throw new Error(`sleepScreen failed: ${res.stderr || res.stdout}`);
}

export async function isScreenOn(adbPath: string, serial: string): Promise<boolean> {
  let res = await adbShell(adbPath, serial, ["dumpsys", "power"]);
  if (res.code === 0) {
    const powerMatch = res.stdout.match(/Display Power: state=(\w+)/i);
    if (powerMatch) { const s = powerMatch[1].toUpperCase(); return s === "ON" || s === "VR"; }
    const screenOnMatch = res.stdout.match(/mScreenOn=(true|false)/i);
    if (screenOnMatch) return screenOnMatch[1].toLowerCase() === "true";
  }
  res = await adbShell(adbPath, serial, ["dumpsys", "display"]);
  if (res.code === 0) {
    const stateMatch = res.stdout.match(/mScreenState=(\w+)/i);
    if (stateMatch) { const s = stateMatch[1].toUpperCase(); return s === "ON" || s === "2"; }
  }
  throw new Error("isScreenOn failed: Could not determine screen state from dumpsys output");
}

export async function unlockScreen(adbPath: string, serial: string): Promise<void> {
  const screenOn = await isScreenOn(adbPath, serial);
  if (!screenOn) {
    await wakeScreen(adbPath, serial);
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  let res = await adbShell(adbPath, serial, ["input", "keyevent", "82"]);
  if (res.code !== 0) {
    res = await adbShell(adbPath, serial, ["input", "swipe", "540", "1800", "540", "500", "300"]);
  }
  if (res.code !== 0) {
    throw new Error(`unlockScreen failed: ${res.stderr || res.stdout}. Only works for devices without secure lock.`);
  }
}

export async function connectWifi(adbPath: string, ipAddress: string, port: number = 5555): Promise<void> {
  const address = `${ipAddress}:${port}`;
  const res = await adbExec(adbPath, ["connect", address]);
  if (res.code !== 0) throw new Error(`connectWifi failed: ${res.stderr || res.stdout}`);
  if (!res.stdout.includes("connected") && !res.stdout.includes("already connected")) {
    throw new Error(`connectWifi failed: ${res.stdout || res.stderr}`);
  }
}

export async function disconnectWifi(adbPath: string, ipAddress?: string): Promise<void> {
  const args = ipAddress ? ["disconnect", ipAddress] : ["disconnect"];
  const res = await adbExec(adbPath, args);
  if (res.code !== 0) throw new Error(`disconnectWifi failed: ${res.stderr || res.stdout}`);
}

export async function enableTcpip(adbPath: string, serial: string, port: number = 5555): Promise<void> {
  const res = await adbExec(adbPath, ["-s", serial, "tcpip", String(port)]);
  if (res.code !== 0) throw new Error(`enableTcpip failed: ${res.stderr || res.stdout}`);
  if (!res.stdout.includes("restarting") && !res.stdout.includes("listening")) {
    throw new Error(`enableTcpip failed: ${res.stdout || res.stderr}`);
  }
}

export async function getDeviceIp(adbPath: string, serial: string): Promise<string | null> {
  let res = await adbShell(adbPath, serial, ["ip", "route"]);
  if (res.code === 0) {
    const ipMatch = res.stdout.match(/src\s+([\d.]+)/);
    if (ipMatch) return ipMatch[1];
  }
  res = await adbShell(adbPath, serial, ["ifconfig", "wlan0"]);
  if (res.code === 0) {
    const inetMatch = res.stdout.match(/inet addr:([\d.]+)/i);
    if (inetMatch) return inetMatch[1];
    const altMatch = res.stdout.match(/inet\s+([\d.]+)/i);
    if (altMatch) return altMatch[1];
  }
  return null;
}

// ============================================================================
// New functions merged from adb-mcp
// ============================================================================

/**
 * Install an APK file on the device.
 * Uses adb install -r to replace existing installation.
 */
export async function installApk(adbPath: string, serial: string, apkPath: string): Promise<string> {
  const res = await adbExec(adbPath, ["-s", serial, "install", "-r", apkPath]);
  const combined = (res.stdout + res.stderr).trim();
  if (res.code !== 0) throw new Error(`installApk failed: ${combined}`);
  if (!combined.includes("Success")) throw new Error(`installApk returned unexpected output: ${combined}`);
  return combined;
}

/**
 * Get device logcat output.
 * Returns the last N lines, optionally filtered.
 */
export async function getLogcat(
  adbPath: string,
  serial: string,
  options?: { lines?: number; filter?: string }
): Promise<string> {
  const lines = options?.lines ?? 50;
  const filterArgs = options?.filter ? splitCommandArguments(options.filter) : [];
  const args = ["-s", serial, "logcat", "-d", ...filterArgs];
  const res = await adbExec(adbPath, args);
  if (res.code !== 0) throw new Error(`getLogcat failed: ${res.stderr || res.stdout}`);
  const logLines = res.stdout.split(/\r?\n/);
  return (lines > 0 ? logLines.slice(-lines) : logLines).join("\n");
}

/**
 * Run an Activity Manager (am) command on the device.
 * e.g. amCommand="start", amArgs="-a android.intent.action.VIEW -d http://example.com"
 */
export async function activityManagerCommand(
  adbPath: string,
  serial: string,
  amCommand: string,
  amArgs?: string
): Promise<string> {
  const additionalArgs = amArgs ? splitCommandArguments(amArgs) : [];
  const res = await adbShell(adbPath, serial, ["am", amCommand, ...additionalArgs]);
  const combined = (res.stdout + res.stderr).trim();
  // "Activity not started" warnings are not failures
  const knownWarnings = [
    "Warning: Activity not started, its current task has been brought to the front",
    "Warning: Activity not started, intent has been delivered to currently running top-most instance.",
  ];
  if (res.code !== 0 && !knownWarnings.some(w => combined.includes(w))) {
    throw new Error(`activityManager failed: ${combined}`);
  }
  return combined || "Command executed successfully";
}

/**
 * Run a Package Manager (pm) command on the device.
 * e.g. pmCommand="list", pmArgs="packages -3"
 */
export async function packageManagerCommand(
  adbPath: string,
  serial: string,
  pmCommand: string,
  pmArgs?: string
): Promise<string> {
  const additionalArgs = pmArgs ? splitCommandArguments(pmArgs) : [];
  const res = await adbShell(adbPath, serial, ["pm", pmCommand, ...additionalArgs]);
  if (res.code !== 0) throw new Error(`packageManager failed: ${res.stderr || res.stdout}`);
  return res.stdout || "Command executed successfully";
}

export async function doubleTap(
  adbPath: string, serial: string, x: number, y: number, intervalMs: number = 100
): Promise<void> {
  await tap(adbPath, serial, x, y);
  await new Promise(r => setTimeout(r, intervalMs));
  await tap(adbPath, serial, x, y);
}

export async function getScreenSize(
  adbPath: string, serial: string
): Promise<{ width: number; height: number; physicalWidth: number; physicalHeight: number }> {
  const res = await adbShell(adbPath, serial, ["wm", "size"]);
  if (res.code !== 0) throw new Error(`getScreenSize failed: ${res.stderr || res.stdout}`);
  const physical = res.stdout.match(/Physical size:\s*(\d+)x(\d+)/);
  const override = res.stdout.match(/Override size:\s*(\d+)x(\d+)/);
  const [pw, ph] = physical ? [parseInt(physical[1]), parseInt(physical[2])] : [0, 0];
  const [ow, oh] = override ? [parseInt(override[1]), parseInt(override[2])] : [pw, ph];
  return { width: ow, height: oh, physicalWidth: pw, physicalHeight: ph };
}

export async function getOrientation(
  adbPath: string, serial: string
): Promise<{ orientation: "portrait" | "landscape" | "portrait_reverse" | "landscape_reverse"; degrees: 0 | 90 | 180 | 270 }> {
  const res = await adbShell(adbPath, serial, ["dumpsys", "window"]);
  if (res.code === 0) {
    const m = res.stdout.match(/mCurrentRotation=ROTATION_(\d+)/);
    if (m) {
      const deg = parseInt(m[1]) as 0 | 90 | 180 | 270;
      const map: Record<number, "portrait" | "landscape" | "portrait_reverse" | "landscape_reverse"> =
        { 0: "portrait", 90: "landscape", 180: "portrait_reverse", 270: "landscape_reverse" };
      return { orientation: map[deg] ?? "portrait", degrees: deg };
    }
  }
  const res2 = await adbShell(adbPath, serial, ["settings", "get", "system", "user_rotation"]);
  const deg = (parseInt(res2.stdout.trim()) || 0) * 90 as 0 | 90 | 180 | 270;
  const map: Record<number, "portrait" | "landscape" | "portrait_reverse" | "landscape_reverse"> =
    { 0: "portrait", 90: "landscape", 180: "portrait_reverse", 270: "landscape_reverse" };
  return { orientation: map[deg] ?? "portrait", degrees: deg };
}

export async function setOrientation(
  adbPath: string, serial: string,
  orientation: "portrait" | "landscape" | "portrait_reverse" | "landscape_reverse" | "auto"
): Promise<void> {
  if (orientation === "auto") {
    const res = await adbShell(adbPath, serial, ["settings", "put", "system", "accelerometer_rotation", "1"]);
    if (res.code !== 0) throw new Error(`setOrientation failed: ${res.stderr || res.stdout}`);
    return;
  }
  const rotMap: Record<string, string> = { portrait: "0", landscape: "1", portrait_reverse: "2", landscape_reverse: "3" };
  const rot = rotMap[orientation];
  const r1 = await adbShell(adbPath, serial, ["settings", "put", "system", "accelerometer_rotation", "0"]);
  if (r1.code !== 0) throw new Error(`setOrientation lock failed: ${r1.stderr || r1.stdout}`);
  const r2 = await adbShell(adbPath, serial, ["settings", "put", "system", "user_rotation", rot]);
  if (r2.code !== 0) throw new Error(`setOrientation rotate failed: ${r2.stderr || r2.stdout}`);
}

export async function openUrl(
  adbPath: string, serial: string, url: string, packageName?: string
): Promise<void> {
  const args = ["am", "start", "-a", "android.intent.action.VIEW", "-d", url];
  if (packageName) args.push("-p", packageName);
  const res = await adbShell(adbPath, serial, args);
  if (res.code !== 0) throw new Error(`openUrl failed: ${res.stderr || res.stdout}`);
}

export async function uninstallApp(
  adbPath: string, serial: string, packageName: string, keepData: boolean = false
): Promise<string> {
  const args = ["-s", serial, "uninstall"];
  if (keepData) args.push("-k");
  args.push(packageName);
  const res = await adbExec(adbPath, args);
  const combined = (res.stdout + res.stderr).trim();
  if (res.code !== 0 && !combined.includes("Success")) {
    throw new Error(`uninstallApp failed: ${combined}`);
  }
  return combined || "Success";
}

export function startScreenRecord(
  adbPath: string, serial: string,
  remotePath: string, timeLimitSecs: number, bitrateMbps: number, size?: string
): ReturnType<typeof spawn> {
  const args = [
    ...(_adbConnPrefix.length ? _adbConnPrefix : []),
    "-s", serial, "shell", "screenrecord",
    "--bit-rate", `${bitrateMbps}M`,
    "--time-limit", String(timeLimitSecs),
  ];
  if (size) args.push("--size", size);
  args.push(remotePath);
  return spawn(adbPath, args, { stdio: ["ignore", "pipe", "pipe"] });
}

export async function stopScreenRecord(
  adbPath: string, serial: string, proc: ReturnType<typeof spawn>
): Promise<void> {
  await adbShell(adbPath, serial, ["pkill", "-2", "screenrecord"]).catch(() => {});
  await new Promise<void>((resolve) => {
    const t = setTimeout(() => { try { proc.kill("SIGTERM"); } catch { /* ignore */ } resolve(); }, 5000);
    proc.once("close", () => { clearTimeout(t); resolve(); });
  });
}
