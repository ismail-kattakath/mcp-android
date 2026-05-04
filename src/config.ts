import path from "node:path";

export type Config = {
  adbPath: string;
  ffmpegPath: string;
  scrcpyServerPath?: string;
  scrcpyServerVersion?: string;
  defaultMaxSize: number;
  defaultMaxFps: number;
  defaultFrameFps: number;
  scrcpySocketPrefix: string;
  rawStreamArg: "raw_stream" | "raw_video_stream";
  logLevel: number;
  // ADB remote server connection (used when running inside Docker MCP gateway)
  // Set ADB_SERVER_HOST=host.docker.internal so the containerized adb client
  // delegates USB device management to the host's adb daemon (port 5037).
  adbServerHost?: string;
  adbServerPort?: number;
};

function envInt(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v) return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function loadConfig(): Config {
  const raw = (process.env.SCRCPY_RAW_STREAM_ARG ?? "raw_stream").trim();
  const rawStreamArg = raw === "raw_video_stream" ? "raw_video_stream" : "raw_stream";

  const scrcpyServerPath = process.env.SCRCPY_SERVER_PATH?.trim();
  const resolvedScrcpyPath = scrcpyServerPath ? path.resolve(scrcpyServerPath) : undefined;

  return {
    adbPath: (process.env.ADB_PATH ?? "adb").trim(),
    ffmpegPath: (process.env.FFMPEG_PATH ?? "ffmpeg").trim(),
    scrcpyServerPath: resolvedScrcpyPath,
    scrcpyServerVersion: process.env.SCRCPY_SERVER_VERSION?.trim(),
    defaultMaxSize: envInt("DEFAULT_MAX_SIZE", 1024),
    defaultMaxFps: envInt("DEFAULT_MAX_FPS", 30),
    defaultFrameFps: envInt("DEFAULT_FRAME_FPS", 2),
    scrcpySocketPrefix: (process.env.SCRCPY_SOCKET_PREFIX ?? "scrcpy").trim(),
    rawStreamArg,
    logLevel: envInt("LOG_LEVEL", 2),
    adbServerHost: process.env.ADB_SERVER_HOST?.trim() || undefined,
    adbServerPort: process.env.ADB_SERVER_PORT ? envInt("ADB_SERVER_PORT", 5037) : undefined,
  };
}

export function log(logLevel: number, level: "ERROR" | "WARN" | "INFO" | "DEBUG", message: string): void {
  const levels = { ERROR: 0, WARN: 1, INFO: 2, DEBUG: 3 };
  if (levels[level] <= logLevel) {
    console.error(`[${level}] ${message}`);
  }
}
