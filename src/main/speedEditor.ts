// Talks to a Blackmagic Design DaVinci Resolve Speed Editor over USB HID, and forwards its input to the renderer.
// This uses node-hid in the main process, because WebHID fails to read the feature reports needed for authentication on Windows.
import HID from 'node-hid';

import logger from './logger.js';
import type { SpeedEditorCommand, SpeedEditorInput, SpeedEditorTransport } from '../common/speedEditor.js';
import { authenticate, authReportSize, encodeCommand, parseInputReport, speedEditorProductId, speedEditorUsagePage, speedEditorVendorId } from '../common/speedEditor.js';


const pollIntervalMs = 3000;

export default function SpeedEditor({ onInput, onConnected }: {
  onInput: (input: SpeedEditorInput) => void,
  onConnected: () => void,
}) {
  let device: HID.HIDAsync | undefined;
  let connecting = false;
  let pollTimer: ReturnType<typeof setInterval> | undefined;
  let reauthTimer: ReturnType<typeof setTimeout> | undefined;

  function createTransport(dev: HID.HIDAsync): SpeedEditorTransport {
    return {
      sendFeatureReport: async (reportId, data) => { await dev.sendFeatureReport([reportId, ...data]); },
      receiveFeatureReport: async (reportId) => new Uint8Array(await dev.getFeatureReport(reportId, authReportSize + 1)), // + report ID
      sendReport: async (reportId, data) => { await dev.write([reportId, ...data]); },
    };
  }

  async function disconnect() {
    clearTimeout(reauthTimer);
    reauthTimer = undefined;
    const dev = device;
    device = undefined;
    if (dev == null) return;
    dev.removeAllListeners();
    try {
      await dev.close();
    } catch {
      // the device may already be gone
    }
  }

  async function authenticateAndScheduleNext(dev: HID.HIDAsync) {
    const timeoutSec = await authenticate(createTransport(dev));
    if (device !== dev) return;
    // authenticate again before the keyboard stops sending reports
    reauthTimer = setTimeout(() => {
      authenticateAndScheduleNext(dev).catch((err: unknown) => {
        logger.error('Speed Editor re-authentication failed', err);
        disconnect();
      });
    }, Math.max(10, timeoutSec * 0.8) * 1000);
  }

  async function tryConnect() {
    if (device != null || connecting) return;
    connecting = true;
    try {
      const devices = await HID.devicesAsync(speedEditorVendorId, speedEditorProductId);
      // The device has several interfaces, we need the vendor defined one (usagePage is not available on all platforms)
      const info = devices.find((d) => d.usagePage === speedEditorUsagePage) ?? devices.find((d) => d.usagePage == null);
      if (info?.path == null) return;

      const dev = await HID.HIDAsync.open(info.path);
      device = dev;
      dev.on('data', (data: Buffer) => {
        const input = parseInputReport(data[0]!, new Uint8Array(data.subarray(1)));
        if (input != null) onInput(input);
      });
      dev.on('error', (err: unknown) => {
        logger.info('Speed Editor disconnected', err);
        disconnect();
      });

      try {
        await authenticateAndScheduleNext(dev);
      } catch (err) {
        await disconnect();
        throw err;
      }
      logger.info('Speed Editor connected');
      onConnected();
    } catch (err) {
      logger.error('Failed to connect to Speed Editor', err);
    } finally {
      connecting = false;
    }
  }

  async function sendCommand(command: SpeedEditorCommand) {
    if (device == null) return;
    const { reportId, data } = encodeCommand(command);
    try {
      await createTransport(device).sendReport(reportId, data);
    } catch (err) {
      logger.warn('Failed to send command to Speed Editor', err);
    }
  }

  function start() {
    tryConnect();
    // node-hid has no hotplug events, so check regularly while no device is connected
    pollTimer = setInterval(() => tryConnect(), pollIntervalMs);
  }

  async function stop() {
    clearInterval(pollTimer);
    await disconnect();
  }

  return {
    start,
    stop,
    sendCommand,
    isConnected: () => device != null && !connecting,
  };
}
