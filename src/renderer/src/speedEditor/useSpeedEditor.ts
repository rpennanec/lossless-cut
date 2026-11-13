import { useEffect, useRef } from 'react';

import type { KeyboardAction } from '../../../common/types';
import type { SpeedEditorCommand, SpeedEditorInput, SpeedEditorKeyName } from '../../../common/speedEditor';
import { speedEditorAbsoluteMax, speedEditorIpcChannels, speedEditorJogLeds, speedEditorJogModes, speedEditorKeyNamesByCode } from '../../../common/speedEditor';

const { ipcRenderer } = window.require('electron');


// Which LosslessCut action each Speed Editor key triggers. Keys not listed here (and the CAM and jog mode keys, see below) do nothing.
export const speedEditorKeyActions: Partial<Record<SpeedEditorKeyName, KeyboardAction>> = {
  IN: 'setCutStart',
  OUT: 'setCutEnd',
  CUT: 'splitCurrentSegment',
  SPLIT: 'splitCurrentSegment',
  SMART_INSRT: 'addSegment',
  APPND: 'duplicateCurrentSegment',
  RIPL_DEL: 'removeCurrentSegment',
  TRIM_IN: 'jumpCutStart',
  TRIM_OUT: 'jumpCutEnd',
  SOURCE: 'jumpSeekPrevSegment',
  TIMELINE: 'jumpSeekNextSegment',
  SLIP_SRC: 'seekBackwardsKeyframe',
  SLIP_DEST: 'seekForwardsKeyframe',
  SNAP: 'toggleKeyframeCutMode',
  TRANS: 'labelCurrentSegment',
  VIDEO_ONLY: 'toggleStripAudio',
  AUDIO_ONLY: 'toggleStripVideo',
  CLOSE_UP: 'timelineToggleComfortZoom',
  FULL_VIEW: 'toggleFullscreenVideo',
  ESC: 'undo',
  SYNC_BIN: 'redo',
  STOP_PLAY: 'togglePlayResetSpeed',
  // LIVE O/WR's secondary label is [RND] (render). Like the keyboard shortcut, press once to show the export confirmation, and again to export.
  LIVE_OWR: 'export',
};

// Actions that are allowed while a dialog is open (the export confirmation)
const actionsAllowedInDialog = new Set<KeyboardAction>(['export']);

// CAM1 to CAM9 select (and seek to) segment 1 to 9
const camKeys: SpeedEditorKeyName[] = ['CAM1', 'CAM2', 'CAM3', 'CAM4', 'CAM5', 'CAM6', 'CAM7', 'CAM8', 'CAM9'];

type WheelMode = 'jog' | 'shuttle' | 'scroll';

const wheelModesByKey: Partial<Record<SpeedEditorKeyName, WheelMode>> = { JOG: 'jog', SHTL: 'shuttle', SCRL: 'scroll' };

// Wheel tuning. The relative wheel unit is the same as the absolute one: +-4096 is about half a turn.
/** jog mode: wheel units per video frame */
const jogUnitsPerFrame = 256;
/** scroll mode: wheel units to scroll through the whole visible (zoomed) timeline */
const scrollUnitsPerTimeline = 16_384;
/** relative wheel movements larger than this in one report are ignored (glitches, e.g. right after connecting) */
const maxRelativeWheelMovement = 32_768;
/** shuttle mode: playback rates, from the center to the end of the wheel's range */
const shuttleRates = [0.25, 0.5, 1, 2, 4, 8, 16];
/** shuttle mode: how often to seek when shuttling backwards (the HTML video element cannot play backwards) */
const shuttleBackwardsTickMs = 50;

export interface SpeedEditorParams {
  runAction: (action: KeyboardAction) => void,
  seekFrames: (frames: number) => void,
  seekRel: (seconds: number) => void,
  /** seek by a fraction of the visible timeline */
  seekRelTimeline: (fraction: number) => void,
  play: () => void,
  pause: () => void,
  isPlaying: () => boolean,
  setPlaybackRate: (rate: number) => void,
  resetPlaybackRate: () => void,
  jumpToSegment: (index: number) => void,
  /** LEDs to light up, see `speedEditorLeds` */
  leds: number,
}

// Like the keyboard shortcuts, don't trigger actions while a dialog is open
const isDialogOpen = () => document.querySelector('[role="dialog"], [role="alertdialog"]') != null;

const sendCommand = (command: SpeedEditorCommand) => ipcRenderer.send(speedEditorIpcChannels.command, command);

/** Turns Speed Editor input (forwarded by the main process, which talks to the device) into LosslessCut actions */
function SpeedEditorController(getParams: () => SpeedEditorParams) {
  let wheelMode: WheelMode = 'jog';
  let heldKeys = new Set<number>();
  let jogRemainder = 0;
  let shuttleRate = 0;
  let shuttleTimer: ReturnType<typeof setInterval> | undefined;

  function stopShuttle() {
    clearInterval(shuttleTimer);
    shuttleTimer = undefined;
    if (shuttleRate === 0) return;
    shuttleRate = 0;
    const params = getParams();
    params.pause();
    params.resetPlaybackRate();
  }

  function setShuttlePosition(position: number) {
    const level = Math.min(shuttleRates.length, Math.ceil((Math.abs(position) / speedEditorAbsoluteMax) * shuttleRates.length));
    const rate = level === 0 ? 0 : Math.sign(position) * shuttleRates[level - 1]!;
    if (rate === shuttleRate) return;

    if (rate === 0) {
      stopShuttle();
      return;
    }

    clearInterval(shuttleTimer);
    shuttleTimer = undefined;
    shuttleRate = rate;
    const params = getParams();
    if (rate > 0) {
      params.setPlaybackRate(rate);
      params.play();
    } else {
      params.pause();
      shuttleTimer = setInterval(() => getParams().seekRel(rate * (shuttleBackwardsTickMs / 1000)), shuttleBackwardsTickMs);
    }
  }

  function setWheelMode(mode: WheelMode) {
    stopShuttle();
    jogRemainder = 0;
    wheelMode = mode;
    // in shuttle mode, the wheel reports its position relative to where it was when the mode was set
    sendCommand({ type: 'setJogMode', mode: mode === 'shuttle' ? speedEditorJogModes.absoluteDeadZero : speedEditorJogModes.relative });
    sendCommand({ type: 'setJogLeds', leds: { jog: speedEditorJogLeds.JOG, shuttle: speedEditorJogLeds.SHTL, scroll: speedEditorJogLeds.SCRL }[mode] });
  }

  function onWheel(value: number) {
    const params = getParams();
    if (wheelMode === 'shuttle') {
      setShuttlePosition(value);
      return;
    }
    if (Math.abs(value) > maxRelativeWheelMovement) return;
    if (wheelMode === 'scroll') {
      params.seekRelTimeline(value / scrollUnitsPerTimeline);
      return;
    }
    if (params.isPlaying()) params.pause();
    jogRemainder += value;
    const frames = Math.trunc(jogRemainder / jogUnitsPerFrame);
    if (frames !== 0) {
      jogRemainder -= frames * jogUnitsPerFrame;
      params.seekFrames(frames);
    }
  }

  function onKeyPress(code: number) {
    const name = speedEditorKeyNamesByCode.get(code);
    if (name == null) return;

    const newWheelMode = wheelModesByKey[name];
    if (newWheelMode != null) {
      setWheelMode(newWheelMode);
      return;
    }

    const action = speedEditorKeyActions[name];
    if (isDialogOpen() && (action == null || !actionsAllowedInDialog.has(action))) return;

    const params = getParams();

    const camIndex = camKeys.indexOf(name);
    if (camIndex !== -1) {
      params.jumpToSegment(camIndex);
      return;
    }

    if (name === 'STOP_PLAY' && shuttleRate !== 0) {
      // stop shuttling, and make the wheel's current position the new center
      stopShuttle();
      sendCommand({ type: 'setJogMode', mode: speedEditorJogModes.absoluteDeadZero });
      return;
    }

    if (action != null) params.runAction(action);
  }

  function onInput(input: SpeedEditorInput) {
    try {
      if (input.type === 'jog') {
        onWheel(input.value);
      } else {
        // the keyboard reports the keys held down, every time that changes. Trigger actions on key press only.
        const pressed = input.keys.filter((key) => !heldKeys.has(key));
        heldKeys = new Set(input.keys);
        pressed.forEach((key) => onKeyPress(key));
      }
    } catch (err) {
      console.error('Speed Editor', err);
    }
  }

  function onConnected() {
    console.log('Speed Editor connected');
    heldKeys = new Set();
    setWheelMode('jog');
    sendCommand({ type: 'setLeds', leds: getParams().leds });
  }

  return {
    onInput,
    onConnected,
    dispose: stopShuttle,
  };
}

/** Support for the Blackmagic Design DaVinci Resolve Speed Editor (the main process talks to the device) */
export default function useSpeedEditor(params: SpeedEditorParams) {
  const paramsRef = useRef(params);
  useEffect(() => {
    paramsRef.current = params;
  });

  useEffect(() => {
    const controller = SpeedEditorController(() => paramsRef.current);
    const onInput = (_e: unknown, input: SpeedEditorInput) => controller.onInput(input);
    const onConnected = () => controller.onConnected();

    ipcRenderer.on(speedEditorIpcChannels.input, onInput);
    ipcRenderer.on(speedEditorIpcChannels.connected, onConnected);
    ipcRenderer.send(speedEditorIpcChannels.rendererReady);

    return () => {
      ipcRenderer.off(speedEditorIpcChannels.input, onInput);
      ipcRenderer.off(speedEditorIpcChannels.connected, onConnected);
      controller.dispose();
    };
  }, []);

  const { leds } = params;
  useEffect(() => {
    sendCommand({ type: 'setLeds', leds });
  }, [leds]);
}
