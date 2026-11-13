# DaVinci Resolve Speed Editor 🎛️

LosslessCut can be controlled with a Blackmagic Design [DaVinci Resolve Speed Editor](https://www.blackmagicdesign.com/products/davinciresolve/keyboards), connected with USB. Just plug it in, no setup or driver is needed. Bluetooth is not supported.

On Linux, you may need a udev rule to give your user access to the device, for example in `/etc/udev/rules.d/50-speed-editor.rules`:

```
SUBSYSTEM=="hidraw", ATTRS{idVendor}=="1edb", ATTRS{idProduct}=="da0e", MODE="0660", TAG+="uaccess"
```

## Keys

| Key | Action |
|---|---|
| <kbd>IN</kbd> | Set the current segment's start (cut start) |
| <kbd>OUT</kbd> | Set the current segment's end (cut end) |
| <kbd>CUT</kbd>, <kbd>SPLIT</kbd> | Split the current segment at the cursor |
| <kbd>SMART INSRT</kbd> | Add a new segment |
| <kbd>APPND</kbd> | Duplicate the current segment |
| <kbd>RIPL DEL</kbd> | Remove the current segment |
| <kbd>TRIM IN</kbd> / <kbd>TRIM OUT</kbd> | Jump to the current segment's start / end |
| <kbd>SOURCE</kbd> / <kbd>TIMELINE</kbd> | Select the previous / next segment, and seek to it |
| <kbd>CAM1</kbd> to <kbd>CAM9</kbd> | Select segment 1 to 9, and seek to it. The key of the current segment lights up |
| <kbd>SLIP SRC</kbd> / <kbd>SLIP DEST</kbd> | Seek to the previous / next keyframe |
| <kbd>SNAP</kbd> | Toggle keyframe cut mode (lit when on) |
| <kbd>TRANS</kbd> | Label the current segment |
| <kbd>VIDEO ONLY</kbd> / <kbd>AUDIO ONLY</kbd> | Toggle stripping the audio / video tracks |
| <kbd>CLOSE UP</kbd> | Toggle the comfortable timeline zoom |
| <kbd>FULL VIEW</kbd> | Toggle fullscreen video |
| <kbd>ESC</kbd> / <kbd>SYNC BIN</kbd> | Undo / redo |
| <kbd>STOP/PLAY</kbd> | Play / pause (and stop shuttling) |
| <kbd>LIVE O/WR</kbd> | Export right away, without showing the export options |

Like keyboard shortcuts, the keys don't do anything while a dialog is open. <kbd>LIVE O/WR</kbd> also exports from the export options.

## Wheel

Select the wheel mode with the keys above the wheel (the selected mode lights up):

- <kbd>JOG</kbd> (default): step frame by frame. Turning the wheel pauses playback.
- <kbd>SHTL</kbd>: shuttle. Turn the wheel away from the center to play forwards or backwards, faster the further you turn (up to 16×). Turn it back to the center, or press <kbd>STOP/PLAY</kbd>, to stop.
- <kbd>SCRL</kbd>: scroll quickly through the visible part of the timeline.
