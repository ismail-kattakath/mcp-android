import net from "node:net";
import { spawn, ChildProcess } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer } from "node:net";
import { adbExec, adbShell } from "./adb.js";
import { JpegFrameExtractor } from "./jpegParser.js";
import {
  encodeTap,
  encodeSwipe,
  encodeLongPressStart,
  encodeLongPressEnd,
  encodeInjectText,
  encodeKeyPress,
  encodeInjectScrollEvent,
  encodeBackOrScreenOn,
  encodeSetScreenPowerMode,
  AKEY_EVENT_ACTION_DOWN,
  AKEY_EVENT_ACTION_UP,
  SCREEN_POWER_MODE_OFF,
  SCREEN_POWER_MODE_NORMAL,
} from "./scrcpyControl.js";

export type StreamOptions = {
  maxSize: number;
  maxFps: number;
  frameFps: number;
  socketPrefix: string;
  rawStreamArg: "raw_stream" | "raw_video_stream";
  scrcpyServerPath: string;
  scrcpyServerVersion: string;
  adbPath: string;
  ffmpegPath: string;
};

export type StreamFrame = {
  jpeg: Buffer;
  ts: number;
};

async function getFreeTcpPort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = createServer();
    srv.listen(0, "127.0.0.1", () => {
      const addr = srv.address();
      srv.close();
      if (typeof addr === "object" && addr?.port) resolve(addr.port);
      else reject(new Error("Unable to allocate a free TCP port"));
    });
    srv.on("error", reject);
  });
}

function genScid(): string {
  const b = randomBytes(4);
  const n = (b.readUInt32BE(0) & 0x7fffffff) >>> 0;
  return String(n);
}

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export class ScrcpySession {
  public readonly serial: string;
  public readonly sessionId: string;
  public readonly resourceUri: string;

  private opts: StreamOptions;
  private localPort: number | null = null;
  private scid: string | null = null;

  private serverProc: ChildProcess | null = null;
  private ffmpegProc: ChildProcess | null = null;
  private tcpSocket: net.Socket | null = null;
  private controlSocket: net.Socket | null = null;

  private extractor = new JpegFrameExtractor();

  private _latest: StreamFrame | null = null;
  private onFrameCb: ((frame: StreamFrame) => void) | null = null;

  private _screenWidth: number = 1080;
  private _screenHeight: number = 1920;
  private _controlReady: boolean = false;

  constructor(serial: string, sessionId: string, opts: StreamOptions) {
    this.serial = serial;
    this.sessionId = sessionId;
    this.opts = opts;
    this.resourceUri = `android://device/${encodeURIComponent(serial)}/frame/latest.jpg`;
  }

  get latest(): StreamFrame | null { return this._latest; }
  get screenWidth(): number { return this._screenWidth; }
  get screenHeight(): number { return this._screenHeight; }
  get controlReady(): boolean { return this._controlReady; }

  onFrame(cb: (frame: StreamFrame) => void) {
    this.onFrameCb = cb;
  }

  async start(): Promise<void> {
    this.scid = genScid();
    this.localPort = await getFreeTcpPort();

    await this.fetchScreenDimensions();

    const remotePath = "/data/local/tmp/scrcpy-server.jar";
    const push = await adbExec(this.opts.adbPath, ["-s", this.serial, "push", this.opts.scrcpyServerPath, remotePath]);
    if (push.code !== 0) throw new Error(`adb push scrcpy-server failed: ${push.stderr || push.stdout}`);

    const socketName = `${this.opts.socketPrefix}_${this.scid}`;
    const fwd = await adbExec(this.opts.adbPath, [
      "-s", this.serial, "forward", `tcp:${this.localPort}`, `localabstract:${socketName}`,
    ]);
    if (fwd.code !== 0) throw new Error(`adb forward failed: ${fwd.stderr || fwd.stdout}`);

    const serverArgs = [
      `CLASSPATH=${remotePath}`,
      "app_process",
      "/",
      "com.genymobile.scrcpy.Server",
      this.opts.scrcpyServerVersion,
      `scid=${this.scid}`,
      "tunnel_forward=true",
      "control=true",
      "audio=false",
      `${this.opts.rawStreamArg}=true`,
      `max_size=${this.opts.maxSize}`,
      `max_fps=${this.opts.maxFps}`,
      "cleanup=true",
    ];

    this.serverProc = spawn(this.opts.adbPath, ["-s", this.serial, "shell", ...serverArgs], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    this.serverProc.stderr?.on("data", () => { /* ignore */ });

    await this.connectAndDecode();
  }

  private async connectAndDecode(): Promise<void> {
    if (this.localPort == null) throw new Error("Session not initialized");

    let videoSocket: net.Socket | null = null;
    let lastErr: unknown = null;
    for (let i = 0; i < 20; i++) {
      try {
        videoSocket = await new Promise<net.Socket>((resolve, reject) => {
          const s = net.createConnection({ host: "127.0.0.1", port: this.localPort! }, () => resolve(s));
          s.once("error", reject);
        });
        break;
      } catch (e) {
        lastErr = e;
        await sleep(100);
      }
    }
    if (!videoSocket) throw new Error(`Failed to connect to scrcpy video socket: ${String(lastErr)}`);

    this.tcpSocket = videoSocket;

    await sleep(50);
    let controlSocket: net.Socket | null = null;
    for (let i = 0; i < 10; i++) {
      try {
        controlSocket = await new Promise<net.Socket>((resolve, reject) => {
          const s = net.createConnection({ host: "127.0.0.1", port: this.localPort! }, () => resolve(s));
          s.once("error", reject);
        });
        break;
      } catch (e) {
        lastErr = e;
        await sleep(100);
      }
    }
    if (controlSocket) {
      this.controlSocket = controlSocket;
      this._controlReady = true;
      controlSocket.on("error", () => { this._controlReady = false; });
      controlSocket.on("close", () => { this._controlReady = false; });
    }

    const socket = videoSocket;

    const ffmpegArgs = [
      "-hide_banner", "-loglevel", "error",
      "-fflags", "nobuffer",
      "-flags", "low_delay",
      "-analyzeduration", "0",
      "-probesize", "32",
      "-f", "h264",
      "-i", "pipe:0",
      "-vf", `fps=${this.opts.frameFps}`,
      "-f", "image2pipe",
      "-vcodec", "mjpeg",
      "-q:v", "5",
      "pipe:1",
    ];

    const ff = spawn(this.opts.ffmpegPath, ffmpegArgs, { stdio: ["pipe", "pipe", "pipe"] });
    this.ffmpegProc = ff;

    socket.pipe(ff.stdin);

    ff.stdout.on("data", (chunk: Buffer) => {
      for (const jpeg of this.extractor.push(chunk)) {
        const frame = { jpeg, ts: Date.now() };
        this._latest = frame;
        this.onFrameCb?.(frame);
      }
    });

    ff.on("close", () => { void this.stop().catch(() => {}); });
    socket.on("close", () => { void this.stop().catch(() => {}); });
    socket.on("error", () => { void this.stop().catch(() => {}); });
  }

  async stop(): Promise<void> {
    this._controlReady = false;
    try { this.controlSocket?.destroy(); } catch {}
    this.controlSocket = null;
    try { this.tcpSocket?.destroy(); } catch {}
    this.tcpSocket = null;
    try { this.ffmpegProc?.kill(); } catch {}
    this.ffmpegProc = null;
    try { this.serverProc?.kill(); } catch {}
    this.serverProc = null;

    if (this.localPort != null) {
      try {
        await adbExec(this.opts.adbPath, ["-s", this.serial, "forward", "--remove", `tcp:${this.localPort}`]);
      } catch {}
    }
    this.localPort = null;
    this.scid = null;
  }

  async health(): Promise<{ ok: boolean; reason?: string }> {
    if (!this.serverProc) return { ok: false, reason: "serverProc not running" };
    if (!this.ffmpegProc) return { ok: false, reason: "ffmpegProc not running" };
    if (!this.tcpSocket) return { ok: false, reason: "tcpSocket not connected" };
    return { ok: true };
  }

  private async fetchScreenDimensions(): Promise<void> {
    try {
      const res = await adbShell(this.opts.adbPath, this.serial, ["wm", "size"]);
      if (res.code === 0) {
        const match = res.stdout.match(/(\d+)x(\d+)/);
        if (match) {
          this._screenWidth = parseInt(match[1], 10);
          this._screenHeight = parseInt(match[2], 10);
        }
      }
    } catch {
      // Use defaults if we can't get screen size
    }
  }

  private sendControl(data: Buffer): boolean {
    if (!this.controlSocket || !this._controlReady) return false;
    try {
      this.controlSocket.write(data);
      return true;
    } catch {
      this._controlReady = false;
      return false;
    }
  }

  fastTap(x: number, y: number): boolean {
    const messages = encodeTap(x, y, this._screenWidth, this._screenHeight);
    for (const msg of messages) {
      if (!this.sendControl(msg)) return false;
    }
    return true;
  }

  async fastSwipe(
    x1: number, y1: number, x2: number, y2: number,
    steps: number = 20, delayMs: number = 0
  ): Promise<boolean> {
    const messages = encodeSwipe(x1, y1, x2, y2, this._screenWidth, this._screenHeight, steps);
    for (const msg of messages) {
      if (!this.sendControl(msg)) return false;
      if (delayMs > 0) await sleep(delayMs);
    }
    return true;
  }

  async fastLongPress(x: number, y: number, durationMs: number = 1000): Promise<boolean> {
    const down = encodeLongPressStart(x, y, this._screenWidth, this._screenHeight);
    if (!this.sendControl(down)) return false;
    await sleep(durationMs);
    const up = encodeLongPressEnd(x, y, this._screenWidth, this._screenHeight);
    return this.sendControl(up);
  }

  fastText(text: string): boolean {
    const msg = encodeInjectText(text);
    return this.sendControl(msg);
  }

  fastKey(keycode: number): boolean {
    const messages = encodeKeyPress(keycode);
    for (const msg of messages) {
      if (!this.sendControl(msg)) return false;
    }
    return true;
  }

  fastScroll(x: number, y: number, hscroll: number, vscroll: number): boolean {
    const msg = encodeInjectScrollEvent(x, y, this._screenWidth, this._screenHeight, hscroll, vscroll);
    return this.sendControl(msg);
  }

  fastBack(): boolean {
    const down = encodeBackOrScreenOn(AKEY_EVENT_ACTION_DOWN);
    const up = encodeBackOrScreenOn(AKEY_EVENT_ACTION_UP);
    return this.sendControl(down) && this.sendControl(up);
  }

  fastScreenPower(on: boolean): boolean {
    const msg = encodeSetScreenPowerMode(on ? SCREEN_POWER_MODE_NORMAL : SCREEN_POWER_MODE_OFF);
    return this.sendControl(msg);
  }
}
