// eslint-disable-next-line import-js/no-extraneous-dependencies
import { describe, expect, test } from 'vitest';

import type { SpeedEditorTransport } from './speedEditor.js';
import { authenticate, computeAuthResponse, encodeCommand, parseInputReport } from './speedEditor.js';

describe('computeAuthResponse', () => {
  // Reference values computed with https://github.com/smunaut/blackmagic-misc/blob/master/bmd.py
  test.each([
    [0x0n, 0x3AE1206F97C10BC8n],
    [0x1n, 0x2B9AB32BEBF244C6n],
    [0x2n, 0x20A4FAB8DF9ADF0An],
    [0x3n, 0x6DF72D1B40AEF698n],
    [0x4n, 0x72226F051E66AB94n],
    [0x5n, 0x3831A3C6032D6A42n],
    [0x6n, 0xFD7FF81881352889n],
    [0x7n, 0x751BF623F42E0ADEn],
    [0x0123456789ABCDEFn, 0xE5C7B689E9967608n],
    [0xFEDCBA9876543210n, 0xC4A7DA4761C769E8n],
    [0xDEADBEEFCAFEBABEn, 0xBD48870E672CF5FAn],
    [0xFFFFFFFFFFFFFFFFn, 0x61A3F6474FF236C6n],
  ])('challenge %s', (challenge, expected) => {
    expect(computeAuthResponse(challenge)).toBe(expected);
  });
});

describe('authenticate', () => {
  test('handshake', async () => {
    const challenge = 0x0123456789ABCDEFn;
    const sent: { reportId: number, data: Uint8Array }[] = [];
    const responses = [
      // node-hid includes the report ID
      [6, 0x00, 0xEF, 0xCD, 0xAB, 0x89, 0x67, 0x45, 0x23, 0x01],
      [6, 0x02, 0, 0, 0, 0, 0, 0, 0, 0],
      [6, 0x04, 0x58, 0x02, 0, 0, 0, 0, 0, 0],
    ];
    const transport: SpeedEditorTransport = {
      sendFeatureReport: async (reportId, data) => { sent.push({ reportId, data }); },
      receiveFeatureReport: async () => new Uint8Array(responses.shift()!),
      sendReport: async () => undefined,
    };

    await expect(authenticate(transport)).resolves.toBe(600);
    expect(sent.map(({ reportId, data }) => [reportId, data.byteLength, data[0]])).toStrictEqual([[6, 9, 0], [6, 9, 1], [6, 9, 3]]);
    expect(new DataView(sent[2]!.data.buffer).getBigUint64(1, true)).toBe(computeAuthResponse(challenge));
  });

  test('fails on unexpected step', async () => {
    const transport: SpeedEditorTransport = {
      sendFeatureReport: async () => undefined,
      receiveFeatureReport: async () => new Uint8Array([6, 0x01, 0, 0, 0, 0, 0, 0, 0, 0]),
      sendReport: async () => undefined,
    };
    await expect(authenticate(transport)).rejects.toThrow('step 0');
  });
});

describe('parseInputReport', () => {
  test('keys', () => {
    expect(parseInputReport(4, new Uint8Array([0x0F, 0, 0x07, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toStrictEqual({ type: 'keys', keys: [0x0F, 0x07] });
  });

  test('jog', () => {
    expect(parseInputReport(3, new Uint8Array([0, 0xFE, 0xFF, 0xFF, 0xFF, 0]))).toStrictEqual({ type: 'jog', value: -2 });
  });

  test('battery', () => {
    expect(parseInputReport(7, new Uint8Array([0, 100]))).toBeUndefined();
  });
});

describe('encodeCommand', () => {
  test('setLeds', () => {
    expect(encodeCommand({ type: 'setLeds', leds: 0x2_00_20 })).toStrictEqual({ reportId: 2, data: new Uint8Array([0x20, 0, 2, 0, 0, 0]) });
  });

  test('setJogMode', () => {
    expect(encodeCommand({ type: 'setJogMode', mode: 3 })).toStrictEqual({ reportId: 3, data: new Uint8Array([3, 0, 0, 0, 0, 255]) });
  });
});
