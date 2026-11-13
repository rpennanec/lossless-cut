// Protocol of the Blackmagic Design DaVinci Resolve Speed Editor (USB HID)
// Reverse engineered by Sylvain Munaut (Apache-2.0): https://github.com/smunaut/blackmagic-misc/blob/master/bmd.py

// The binary protocol (LED bitfields, authentication) needs bitwise operators
/* eslint-disable no-bitwise */

export const speedEditorVendorId = 0x1E_DB;
export const speedEditorProductId = 0xDA_0E;
/** The Speed Editor's HID interface for keys, wheel and LEDs */
export const speedEditorUsagePage = 0xFF_00;

export const isSpeedEditor = ({ vendorId, productId }: { vendorId: number, productId: number }) => vendorId === speedEditorVendorId && productId === speedEditorProductId;

// Input report 4 contains up to 6 LE16 key codes of the keys currently held down
export const speedEditorKeys = {
  SMART_INSRT: 0x01,
  APPND: 0x02,
  RIPL_OWR: 0x03,
  CLOSE_UP: 0x04,
  PLACE_ON_TOP: 0x05,
  SRC_OWR: 0x06,
  IN: 0x07,
  OUT: 0x08,
  TRIM_IN: 0x09,
  TRIM_OUT: 0x0A,
  ROLL: 0x0B,
  SLIP_SRC: 0x0C,
  SLIP_DEST: 0x0D,
  TRANS_DUR: 0x0E,
  CUT: 0x0F,
  DIS: 0x10,
  SMTH_CUT: 0x11,
  SOURCE: 0x1A,
  TIMELINE: 0x1B,
  SHTL: 0x1C,
  JOG: 0x1D,
  SCRL: 0x1E,
  SYNC_BIN: 0x1F,
  TRANS: 0x22,
  VIDEO_ONLY: 0x25,
  AUDIO_ONLY: 0x26,
  RIPL_DEL: 0x2B,
  AUDIO_LEVEL: 0x2C,
  FULL_VIEW: 0x2D,
  SNAP: 0x2E,
  SPLIT: 0x2F,
  LIVE_OWR: 0x30,
  ESC: 0x31,
  CAM1: 0x33,
  CAM2: 0x34,
  CAM3: 0x35,
  CAM4: 0x36,
  CAM5: 0x37,
  CAM6: 0x38,
  CAM7: 0x39,
  CAM8: 0x3A,
  CAM9: 0x3B,
  STOP_PLAY: 0x3C,
} as const;

export type SpeedEditorKeyName = keyof typeof speedEditorKeys;

export const speedEditorKeyNamesByCode = new Map<number, SpeedEditorKeyName>(Object.entries(speedEditorKeys).map(([name, code]) => [code, name as SpeedEditorKeyName]));

// Output report 2: LE32 bitfield of the LEDs to light up
export const speedEditorLeds = {
  CLOSE_UP: 1,
  CUT: 1 << 1,
  DIS: 1 << 2,
  SMTH_CUT: 1 << 3,
  TRANS: 1 << 4,
  SNAP: 1 << 5,
  CAM7: 1 << 6,
  CAM8: 1 << 7,
  CAM9: 1 << 8,
  LIVE_OWR: 1 << 9,
  CAM4: 1 << 10,
  CAM5: 1 << 11,
  CAM6: 1 << 12,
  VIDEO_ONLY: 1 << 13,
  CAM1: 1 << 14,
  CAM2: 1 << 15,
  CAM3: 1 << 16,
  AUDIO_ONLY: 1 << 17,
} as const;

const camLeds = [speedEditorLeds.CAM1, speedEditorLeds.CAM2, speedEditorLeds.CAM3, speedEditorLeds.CAM4, speedEditorLeds.CAM5, speedEditorLeds.CAM6, speedEditorLeds.CAM7, speedEditorLeds.CAM8, speedEditorLeds.CAM9];

/** SNAP is lit when keyframe cut mode is on, and the CAM key of the current segment (1 to 9) is lit */
export const getSpeedEditorLeds = ({ keyframeCut, currentSegIndex }: { keyframeCut: boolean, currentSegIndex: number }) => (keyframeCut ? speedEditorLeds.SNAP : 0) | (camLeds[currentSegIndex] ?? 0);

// Output report 4: 8 bit bitfield of the jog mode button LEDs
export const speedEditorJogLeds = {
  JOG: 1,
  SHTL: 1 << 1,
  SCRL: 1 << 2,
} as const;

export const speedEditorJogModes = {
  /** Sends the relative movement since the last report */
  relative: 0,
  /** Sends an "absolute" position relative to the position when the mode was set, -4096 to 4096 (about half a turn) */
  absoluteContinuous: 1,
  /** Like absoluteContinuous, but with a small dead band around zero */
  absoluteDeadZero: 3,
} as const;

export type SpeedEditorJogMode = typeof speedEditorJogModes[keyof typeof speedEditorJogModes];

export const speedEditorAbsoluteMax = 4096;

/** Messages between the main process (which talks to the device) and the renderer */
export type SpeedEditorInput = { type: 'keys', keys: number[] } | { type: 'jog', value: number };

export type SpeedEditorCommand = { type: 'setLeds', leds: number } | { type: 'setJogLeds', leds: number } | { type: 'setJogMode', mode: SpeedEditorJogMode };

export const speedEditorIpcChannels = {
  /** main -> renderer: `SpeedEditorInput` */
  input: 'speedEditorInput',
  /** main -> renderer: a Speed Editor was connected and authenticated */
  connected: 'speedEditorConnected',
  /** renderer -> main: `SpeedEditorCommand` */
  command: 'speedEditorCommand',
  /** renderer -> main: the renderer is listening (main replies with `connected` if a device is already connected) */
  rendererReady: 'speedEditorRendererReady',
} as const;

/** How we talk to the device. Report payloads exclude the report ID. */
export interface SpeedEditorTransport {
  sendFeatureReport: (reportId: number, data: Uint8Array) => Promise<void>,
  /** May or may not include the report ID as the first byte, depending on the HID library */
  receiveFeatureReport: (reportId: number) => Promise<Uint8Array>,
  sendReport: (reportId: number, data: Uint8Array) => Promise<void>,
}

// Report sizes, without the report ID.
// Note: the HID descriptor declares 32 byte feature reports, but the authentication only works with 9 byte ones
// (reading a longer feature report fails on Windows, which is also why WebHID cannot be used)
export const authReportSize = 9;
const outputReportSize = 6;

/** Creates a zero-padded report payload, and calls `write` to fill it in */
function makeReport(size: number, write: (view: DataView) => void) {
  const data = new Uint8Array(size);
  write(new DataView(data.buffer));
  return data;
}

export const encodeCommand = (command: SpeedEditorCommand): { reportId: number, data: Uint8Array } => {
  if (command.type === 'setLeds') return { reportId: 2, data: makeReport(outputReportSize, (view) => view.setUint32(0, command.leds >>> 0, true)) };
  if (command.type === 'setJogLeds') return { reportId: 4, data: makeReport(outputReportSize, (view) => view.setUint8(0, command.leds)) };
  return {
    reportId: 3,
    data: makeReport(outputReportSize, (view) => {
      view.setUint8(0, command.mode);
      view.setUint8(5, 255);
    }),
  };
};

/** @param data report payload, without the report ID */
export function parseInputReport(reportId: number, data: Uint8Array): SpeedEditorInput | undefined {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (reportId === 3 && data.byteLength >= 5) {
    // u8 jog mode, le32 jog value (signed)
    return { type: 'jog', value: view.getInt32(1, true) };
  }
  if (reportId === 4) {
    // le16[6] keys held down, 0 = no key
    const keys: number[] = [];
    for (let i = 0; i + 1 < data.byteLength && i < 12; i += 2) {
      const key = view.getUint16(i, true);
      if (key !== 0) keys.push(key);
    }
    return { type: 'keys', keys };
  }
  // report 7 is battery status
  return undefined;
}

// Authentication: the keyboard doesn't send any reports before the host has answered its challenge

const mask64 = (1n << 64n) - 1n;

const rol8 = (v: bigint) => ((v << 56n) | (v >> 8n)) & mask64;

const authEvenTable = [
  0x3AE1206F97C10BC8n,
  0x2A9AB32BEBF244C6n,
  0x20A6F8B8DF9ADF0An,
  0xAF80ECE52CFC1719n,
  0xEC2EE2F7414FD151n,
  0xB055ADFD73344A15n,
  0xA63D2E3059001187n,
  0x751BF623F42E0DDEn,
];

const authOddTable = [
  0x3E22B34F502E7FDEn,
  0x24656B981875AB1Cn,
  0xA17F3456DF7BF8C3n,
  0x6DF72E1941AEF698n,
  0x72226F011E66AB94n,
  0x3831A3C606296B42n,
  0xFD7FF81881332C89n,
  0x61A3F6474FF236C6n,
];

const authMask = 0xA79A63F585D37BF0n;

export function computeAuthResponse(challenge: bigint) {
  const n = Number(challenge & 7n);
  let v = challenge;
  for (let i = 0; i < n; i += 1) v = rol8(v);

  let k: bigint;
  if (Number(v & 1n) === ((0x78 >> n) & 1)) {
    k = authEvenTable[n]!;
  } else {
    v ^= rol8(v);
    k = authOddTable[n]!;
  }
  return v ^ (rol8(v) & authMask) ^ k;
}

const authReportId = 6;

async function sendAuthReport(transport: SpeedEditorTransport, step: number, value = 0n) {
  await transport.sendFeatureReport(authReportId, makeReport(authReportSize, (view) => {
    view.setUint8(0, step);
    view.setBigUint64(1, value, true);
  }));
}

async function readAuthReport(transport: SpeedEditorTransport, expectedStep: number) {
  const bytes = await transport.receiveFeatureReport(authReportId);
  // steps are 0 to 4, so a first byte of 6 is the report ID
  const payload = bytes[0] === authReportId ? bytes.subarray(1) : bytes;
  if (payload.byteLength < 9 || payload[0] !== expectedStep) throw new Error(`Speed Editor authentication failed at step ${expectedStep}`);
  return new DataView(payload.buffer, payload.byteOffset + 1, payload.byteLength - 1);
}

/** @returns the number of seconds after which the keyboard needs to be authenticated again */
export async function authenticate(transport: SpeedEditorTransport) {
  // Reset the auth state machine
  await sendAuthReport(transport, 0x00);

  // Read the keyboard's challenge
  const challenge = (await readAuthReport(transport, 0x00)).getBigUint64(0, true);

  // Send our challenge to the keyboard (we don't need to authenticate the keyboard, so it's zero)
  await sendAuthReport(transport, 0x01);
  await readAuthReport(transport, 0x02);

  // Send our response
  await sendAuthReport(transport, 0x03, computeAuthResponse(challenge));

  return (await readAuthReport(transport, 0x04)).getUint16(0, true);
}
