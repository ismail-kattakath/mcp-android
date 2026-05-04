/**
 * scrcpy control protocol message encoder
 *
 * Based on scrcpy control protocol documentation:
 * - All values are big-endian
 * - Touch events are 32 bytes
 * - Key events are 14 bytes
 * - Text injection is variable length
 *
 * Reference: https://github.com/ArtifactForms/scrcpy/blob/master/CONTROL-PROTOCOL.md
 */

// Message type constants (from scrcpy control_msg.h)
export const MSG_TYPE_INJECT_KEYCODE = 0;
export const MSG_TYPE_INJECT_TEXT = 1;
export const MSG_TYPE_INJECT_TOUCH_EVENT = 2;
export const MSG_TYPE_INJECT_SCROLL_EVENT = 3;
export const MSG_TYPE_BACK_OR_SCREEN_ON = 4;
export const MSG_TYPE_EXPAND_NOTIFICATION_PANEL = 5;
export const MSG_TYPE_EXPAND_SETTINGS_PANEL = 6;
export const MSG_TYPE_COLLAPSE_PANELS = 7;
export const MSG_TYPE_GET_CLIPBOARD = 8;
export const MSG_TYPE_SET_CLIPBOARD = 9;
export const MSG_TYPE_SET_SCREEN_POWER_MODE = 10;
export const MSG_TYPE_ROTATE_DEVICE = 11;
export const MSG_TYPE_UHID_CREATE = 12;
export const MSG_TYPE_UHID_INPUT = 13;
export const MSG_TYPE_OPEN_HARD_KEYBOARD_SETTINGS = 14;

// Touch action constants (Android MotionEvent)
export const AMOTION_EVENT_ACTION_DOWN = 0;
export const AMOTION_EVENT_ACTION_UP = 1;
export const AMOTION_EVENT_ACTION_MOVE = 2;
export const AMOTION_EVENT_ACTION_CANCEL = 3;
export const AMOTION_EVENT_ACTION_POINTER_DOWN = 5;
export const AMOTION_EVENT_ACTION_POINTER_UP = 6;

// Key action constants (Android KeyEvent)
export const AKEY_EVENT_ACTION_DOWN = 0;
export const AKEY_EVENT_ACTION_UP = 1;

// Mouse button constants
export const AMOTION_EVENT_BUTTON_PRIMARY = 1;
export const AMOTION_EVENT_BUTTON_SECONDARY = 2;
export const AMOTION_EVENT_BUTTON_TERTIARY = 4;

// Screen power modes
export const SCREEN_POWER_MODE_OFF = 0;
export const SCREEN_POWER_MODE_NORMAL = 2;

export function encodeInjectTouchEvent(
  action: number,
  pointerId: bigint,
  x: number,
  y: number,
  screenWidth: number,
  screenHeight: number,
  pressure: number = 1.0,
  actionButton: number = 0,
  buttons: number = 0
): Buffer {
  const buf = Buffer.alloc(32);
  let offset = 0;
  buf.writeUInt8(MSG_TYPE_INJECT_TOUCH_EVENT, offset); offset += 1;
  buf.writeUInt8(action, offset); offset += 1;
  buf.writeBigInt64BE(pointerId, offset); offset += 8;
  buf.writeUInt32BE(Math.floor(x), offset); offset += 4;
  buf.writeUInt32BE(Math.floor(y), offset); offset += 4;
  buf.writeUInt16BE(screenWidth, offset); offset += 2;
  buf.writeUInt16BE(screenHeight, offset); offset += 2;
  const pressureNorm = Math.floor(Math.max(0, Math.min(1, pressure)) * 65535);
  buf.writeUInt16BE(pressureNorm, offset); offset += 2;
  buf.writeUInt32BE(actionButton, offset); offset += 4;
  buf.writeUInt32BE(buttons, offset);
  return buf;
}

export function encodeInjectKeycode(
  action: number,
  keycode: number,
  repeat: number = 0,
  metastate: number = 0
): Buffer {
  const buf = Buffer.alloc(14);
  let offset = 0;
  buf.writeUInt8(MSG_TYPE_INJECT_KEYCODE, offset); offset += 1;
  buf.writeUInt8(action, offset); offset += 1;
  buf.writeUInt32BE(keycode, offset); offset += 4;
  buf.writeUInt32BE(repeat, offset); offset += 4;
  buf.writeUInt32BE(metastate, offset);
  return buf;
}

export function encodeInjectText(text: string): Buffer {
  const textBytes = Buffer.from(text, "utf8");
  const buf = Buffer.alloc(5 + textBytes.length);
  let offset = 0;
  buf.writeUInt8(MSG_TYPE_INJECT_TEXT, offset); offset += 1;
  buf.writeUInt32BE(textBytes.length, offset); offset += 4;
  textBytes.copy(buf, offset);
  return buf;
}

export function encodeInjectScrollEvent(
  x: number,
  y: number,
  screenWidth: number,
  screenHeight: number,
  hscroll: number,
  vscroll: number
): Buffer {
  const buf = Buffer.alloc(21);
  let offset = 0;
  buf.writeUInt8(MSG_TYPE_INJECT_SCROLL_EVENT, offset); offset += 1;
  buf.writeUInt32BE(Math.floor(x), offset); offset += 4;
  buf.writeUInt32BE(Math.floor(y), offset); offset += 4;
  buf.writeUInt16BE(screenWidth, offset); offset += 2;
  buf.writeUInt16BE(screenHeight, offset); offset += 2;
  buf.writeInt32BE(Math.floor(hscroll), offset); offset += 4;
  buf.writeInt32BE(Math.floor(vscroll), offset);
  return buf;
}

export function encodeBackOrScreenOn(action: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt8(MSG_TYPE_BACK_OR_SCREEN_ON, 0);
  buf.writeUInt8(action, 1);
  return buf;
}

export function encodeExpandNotificationPanel(): Buffer {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(MSG_TYPE_EXPAND_NOTIFICATION_PANEL, 0);
  return buf;
}

export function encodeExpandSettingsPanel(): Buffer {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(MSG_TYPE_EXPAND_SETTINGS_PANEL, 0);
  return buf;
}

export function encodeCollapsePanels(): Buffer {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(MSG_TYPE_COLLAPSE_PANELS, 0);
  return buf;
}

export function encodeGetClipboard(copyKey: number = 0): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt8(MSG_TYPE_GET_CLIPBOARD, 0);
  buf.writeUInt8(copyKey, 1);
  return buf;
}

export function encodeSetClipboard(
  text: string,
  sequence: bigint = BigInt(0),
  paste: boolean = false
): Buffer {
  const textBytes = Buffer.from(text, "utf8");
  const buf = Buffer.alloc(14 + textBytes.length);
  let offset = 0;
  buf.writeUInt8(MSG_TYPE_SET_CLIPBOARD, offset); offset += 1;
  buf.writeBigUInt64BE(sequence, offset); offset += 8;
  buf.writeUInt8(paste ? 1 : 0, offset); offset += 1;
  buf.writeUInt32BE(textBytes.length, offset); offset += 4;
  textBytes.copy(buf, offset);
  return buf;
}

export function encodeSetScreenPowerMode(mode: number): Buffer {
  const buf = Buffer.alloc(2);
  buf.writeUInt8(MSG_TYPE_SET_SCREEN_POWER_MODE, 0);
  buf.writeUInt8(mode, 1);
  return buf;
}

export function encodeRotateDevice(): Buffer {
  const buf = Buffer.alloc(1);
  buf.writeUInt8(MSG_TYPE_ROTATE_DEVICE, 0);
  return buf;
}

export function encodeTap(
  x: number,
  y: number,
  screenWidth: number,
  screenHeight: number,
  pointerId: bigint = BigInt(-1)
): Buffer[] {
  return [
    encodeInjectTouchEvent(AMOTION_EVENT_ACTION_DOWN, pointerId, x, y, screenWidth, screenHeight, 1.0, AMOTION_EVENT_BUTTON_PRIMARY, AMOTION_EVENT_BUTTON_PRIMARY),
    encodeInjectTouchEvent(AMOTION_EVENT_ACTION_UP, pointerId, x, y, screenWidth, screenHeight, 0, AMOTION_EVENT_BUTTON_PRIMARY, 0),
  ];
}

export function encodeSwipe(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  screenWidth: number,
  screenHeight: number,
  steps: number = 20,
  pointerId: bigint = BigInt(-1)
): Buffer[] {
  const messages: Buffer[] = [];
  messages.push(encodeInjectTouchEvent(AMOTION_EVENT_ACTION_DOWN, pointerId, x1, y1, screenWidth, screenHeight, 1.0, AMOTION_EVENT_BUTTON_PRIMARY, AMOTION_EVENT_BUTTON_PRIMARY));
  for (let i = 1; i <= steps; i++) {
    const t = i / steps;
    const x = x1 + (x2 - x1) * t;
    const y = y1 + (y2 - y1) * t;
    messages.push(encodeInjectTouchEvent(AMOTION_EVENT_ACTION_MOVE, pointerId, x, y, screenWidth, screenHeight, 1.0, 0, AMOTION_EVENT_BUTTON_PRIMARY));
  }
  messages.push(encodeInjectTouchEvent(AMOTION_EVENT_ACTION_UP, pointerId, x2, y2, screenWidth, screenHeight, 0, AMOTION_EVENT_BUTTON_PRIMARY, 0));
  return messages;
}

export function encodeLongPressStart(
  x: number,
  y: number,
  screenWidth: number,
  screenHeight: number,
  pointerId: bigint = BigInt(-1)
): Buffer {
  return encodeInjectTouchEvent(AMOTION_EVENT_ACTION_DOWN, pointerId, x, y, screenWidth, screenHeight, 1.0, AMOTION_EVENT_BUTTON_PRIMARY, AMOTION_EVENT_BUTTON_PRIMARY);
}

export function encodeLongPressEnd(
  x: number,
  y: number,
  screenWidth: number,
  screenHeight: number,
  pointerId: bigint = BigInt(-1)
): Buffer {
  return encodeInjectTouchEvent(AMOTION_EVENT_ACTION_UP, pointerId, x, y, screenWidth, screenHeight, 0, AMOTION_EVENT_BUTTON_PRIMARY, 0);
}

export function encodeKeyPress(keycode: number, metastate: number = 0): Buffer[] {
  return [
    encodeInjectKeycode(AKEY_EVENT_ACTION_DOWN, keycode, 0, metastate),
    encodeInjectKeycode(AKEY_EVENT_ACTION_UP, keycode, 0, metastate),
  ];
}
