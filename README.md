# Nintendo GBA WeChat Mini Game

English | [中文](README.zh-CN.md)

A Game Boy Advance emulator experiment for the WeChat Mini Game runtime. It provides a handheld-style interface with portrait and landscape layouts, virtual controls, online ROM loading, local ROM import, instant save states, automatic battery saves, and audio output.

The emulator core is based on mGBA compiled to WebAssembly. The game entry is `game.js`, and most of the runtime logic lives in `js/main.js` and `js/gba`.

## Features

- GBA-style interface with screen, D-pad, A/B, L/R, START, and SELECT.
- Portrait and landscape layouts. Landscape mode requests the real device orientation change.
- Online ROM download with visible progress.
- Local `.gba` ROM import from WeChat files.
- Fast local debug ROM loading in WeChat DevTools from the `rom` directory.
- mGBA-based WebAssembly emulator core.
- Real 16KB GBA BIOS support.
- Instant save and instant load.
- Battery-backed SRAM/FLASH/EEPROM save data persisted to WeChat local storage.
- WebAudio-based audio output.
- Pause, resume, reset, and frame-skip performance modes.

## Project Structure

```text
.
|-- game.js                     # WeChat Mini Game entry
|-- game.json                   # Mini Game configuration
|-- project.config.json         # WeChat DevTools project configuration
|-- js
|   |-- main.js                 # Main flow, ROM loading, lifecycle, render loop
|   |-- render.js               # Canvas setup and window resize handling
|   `-- gba
|       |-- audio.js            # WeChat Mini Game audio output
|       |-- controls.js         # Touch handling and virtual buttons
|       |-- emulator.js         # mGBA WASM adapter
|       |-- layout.js           # Portrait/landscape layout
|       |-- rom.js              # ROM/BIOS loading, download, local import
|       |-- rom-config.js       # Online ROM/BIOS configuration
|       `-- wasm                # mGBA WASM artifacts
`-- rom                         # Local development ROMs; should be ignored for release
```

## How It Works

The project has three main layers: the WeChat Mini Game shell, the JavaScript adapter layer, and the mGBA WASM core.

```text
Touch input / lifecycle / Canvas / WebAudio / file system / cloud download
                      |
                      v
              js/main.js coordinates the app
                      |
                      v
       js/gba/emulator.js adapts the mGBA WASM core
                      |
                      v
          js/gba/wasm/mgba-wechat.wasm
```

### 1. From mGBA to WASM

The low-level emulation logic, including the GBA CPU, PPU, APU, cartridge save hardware, and timing, is handled by mGBA. In this project, `js/gba/wasm/mgba-wechat.wasm` is the compiled emulator core, and `js/gba/wasm/mgba-wechat.js` is the Emscripten-generated loader glue.

The WASM core exports a small C API that is called by the JavaScript adapter:

- `_gba_load_rom`: loads the ROM and optional BIOS.
- `_gba_run_frame`: advances the emulator by one GBA frame.
- `_gba_set_keys`: updates the current input state.
- `_gba_get_frame_ptr` / `_gba_get_frame_size`: exposes the current video framebuffer.
- `_gba_pull_audio` / `_gba_get_audio_ptr`: exposes generated audio samples.
- `_gba_export_save` / `_gba_import_save`: exports and imports battery save data.
- `_gba_export_state` / `_gba_import_state`: exports and imports instant save states.

### 2. Building mGBA as WASM

The current WASM artifact is not a direct build of the mGBA desktop application. The build first compiles mGBA as a static library, then links it with a thin C bridge that exposes the functions needed by JavaScript.

The build pipeline looks like this:

```text
mGBA source
   |
   |-- Emscripten/CMake builds libmgba.a
   |
   `-- wasm_bridge.c calls the mGBA core API
          |
          v
   emcc links libmgba.a + bridge
          |
          v
   mgba-wechat.js + mgba-wechat.wasm
```

The bridge layer is responsible for:

- Creating and destroying the mGBA core.
- Passing ROM and BIOS memory from JavaScript into mGBA.
- Running one emulated frame per call.
- Converting the 240 x 160 mGBA video frame into an RGBA buffer readable by JavaScript.
- Exposing stereo `float32` audio samples.
- Wrapping battery save and instant state import/export.
- Mapping the JavaScript key bit mask into mGBA input state.

A simplified build flow is shown below. Exact CMake options may vary across mGBA versions, so treat this as a reproducible template rather than a frozen universal command.

```sh
# 1. Prepare Emscripten. emcc / emcmake / cmake should be available.
emcc --version

# 2. Fetch mGBA.
git clone --recursive https://github.com/mgba-emu/mgba.git /tmp/mgba-src

# 3. Configure a static mGBA build with Emscripten.
emcmake cmake -S /tmp/mgba-src -B /tmp/mgba-build \
  -DCMAKE_BUILD_TYPE=Release \
  -DBUILD_SHARED=OFF \
  -DBUILD_STATIC=ON \
  -DBUILD_QT=OFF \
  -DBUILD_SDL=OFF \
  -DBUILD_GL=OFF \
  -DBUILD_GLES2=OFF \
  -DBUILD_GLES3=OFF \
  -DBUILD_TEST=OFF

# 4. Build the static library.
cmake --build /tmp/mgba-build -j 8

# 5. Link the bridge and libmgba.a into the WeChat Mini Game WASM artifacts.
emcc /tmp/mgba-bridge/wasm_bridge.c /tmp/mgba-build/libmgba.a \
  -I/tmp/mgba-src/include \
  -I/tmp/mgba-build/include \
  -O3 \
  -flto \
  -D_GNU_SOURCE \
  -D_DEFAULT_SOURCE \
  -DPATH_MAX=4096 \
  -DDISABLE_THREADING \
  -s MODULARIZE=1 \
  -s EXPORT_ES6=0 \
  -s ENVIRONMENT=web \
  -s ALLOW_MEMORY_GROWTH=1 \
  -s INITIAL_MEMORY=67108864 \
  -s EXPORTED_FUNCTIONS='["_malloc","_free","_gba_load_rom","_gba_unload","_gba_set_keys","_gba_reset","_gba_run_frame","_gba_get_frame_ptr","_gba_get_frame_size","_gba_get_width","_gba_get_height","_gba_get_frame_count","_gba_pull_audio","_gba_get_audio_ptr","_gba_get_audio_frame_count","_gba_get_audio_sample_rate","_gba_export_save","_gba_get_save_ptr","_gba_get_save_size","_gba_import_save","_gba_export_state","_gba_get_state_ptr","_gba_get_state_size","_gba_import_state"]' \
  -s EXPORTED_RUNTIME_METHODS='["HEAPU8"]' \
  -o js/gba/wasm/mgba-wechat.js
```

Important Emscripten flags:

- `MODULARIZE=1`: emits a factory function, making async initialization easier in `emulator.js`.
- `EXPORT_ES6=0`: emits CommonJS/plain-script style glue that works better with the WeChat Mini Game build environment.
- `ENVIRONMENT=web`: generates a web-targeted runtime.
- `ALLOW_MEMORY_GROWTH=1`: lets WASM memory grow when larger ROMs or save states need more memory.
- `INITIAL_MEMORY=67108864`: starts with 64MB of memory to reduce early runtime growth.
- `EXPORTED_FUNCTIONS`: exports only the functions the JavaScript adapter needs.
- `EXPORTED_RUNTIME_METHODS=["HEAPU8"]`: exposes WASM linear memory for copying ROM, BIOS, video, audio, and save data.

After building, place `mgba-wechat.js` and `mgba-wechat.wasm` in `js/gba/wasm`. `emulator.js` loads `js/gba/wasm/mgba-wechat.wasm` through the generated JavaScript wrapper.

For long-term maintenance, keep `wasm_bridge.c` and build scripts in the repository, for example under `tools/mgba-wasm/`. That lets contributors rebuild the WASM artifacts instead of relying only on checked-in binaries.

### 3. WeChat Mini Game Runtime Adaptation

The WeChat Mini Game runtime is not a full browser, so `js/gba/emulator.js` installs a few minimal shims such as `document`, `performance`, `crypto`, and `WebAssembly`.

WASM loading first tries `WXWebAssembly.instantiate`, which is provided by the WeChat runtime. If that path is unavailable or fails, the adapter reads the packaged `.wasm` file and falls back to standard `WebAssembly.instantiate`.

ROM and BIOS loading is handled by `js/gba/rom.js`:

- Online mode uses `wx.downloadFile` or `wx.cloud.downloadFile`, reporting progress back to the UI.
- Local mode uses `wx.chooseMessageFile` to select `.gba`, `.bin`, or `.rom` files.
- DevTools mode first tries a local debug ROM to avoid repeated network downloads.
- BIOS loading can use `js/gba/gba_bios.bin`, cloud storage, HTTPS, or an optional embedded value in `js/gba/bundled-bios.js`. The repository keeps `bundled-bios.js` as an empty placeholder.

### 4. Frame Loop and Rendering

The original GBA resolution is 240 x 160, and its nominal refresh rate is about 59.7275 FPS. `GBAEmulatorAdapter` uses `requestAnimationFrame` and a GBA-frame-time budget to drive the emulation loop.

On each tick, the adapter calls `_gba_run_frame` one or more times based on the accumulated budget. It can catch up after a short stall, but caps catch-up work to four frames per tick to avoid blocking the main thread for too long.

After a frame is emulated, the adapter reads the 240 x 160 RGBA framebuffer from WASM memory into an `ImageData` object. At render time it scales that frame into the current screen rectangle and disables `imageSmoothingEnabled` to preserve the pixel-art look.

Frame skip does not reduce the number of emulated frames. It reduces framebuffer copying and Canvas drawing frequency, while audio is still pulled continuously to keep timing and sound more stable.

### 5. Input Mapping

`js/gba/controls.js` maps touch positions to virtual buttons. The current input state is packed into a bit mask:

- A/B/SELECT/START
- D-pad up/down/left/right
- L/R

When touches start, move, or end, the adapter calls `_gba_set_keys(mask)` to synchronize the current input state into the WASM core.

### 6. Audio Output

mGBA produces stereo floating-point PCM samples. After each emulated frame, `emulator.js` calls `_gba_pull_audio`, then reads the generated samples from WASM memory.

`js/gba/audio.js` creates a WebAudio context with `wx.createWebAudioContext`, resamples core audio to the device output sample rate, and queues it through `AudioBufferSourceNode`. The queue is intentionally short to reduce latency; if it grows too far ahead, playback is pulled back near the current audio time.

### 7. Save System

The project has two save systems:

- Battery save: emulates cartridge SRAM/FLASH/EEPROM. The core exports save data, JavaScript converts it to base64, and stores it with `wx.setStorageSync`. The emulator tries to save on pause, ROM switch, and about every 300 emulated frames.
- Instant state: stores the full emulator state, including CPU, memory, PPU/APU state, save data, RTC data, and metadata. The `存` button exports it, and the `读` button restores it.

Save keys are generated from the ROM length and content hash, so different ROMs do not overwrite each other even if they share a filename.

### 8. Layout and Orientation

`js/gba/layout.js` detects portrait or landscape mode from the Canvas dimensions and calculates the screen, controls, status line, and top command buttons. The `横` / `竖` button calls `wx.setDeviceOrientation` through `main.js`, requesting a real device orientation change. When the window size changes, the layout is recalculated.

## Running the Project

1. Install and open WeChat DevTools.
2. Choose Mini Game and import this project directory.
3. Compile and run.
4. Tap `在线` to download the ROM configured in `js/gba/rom-config.js`, or tap `本地` to choose a local `.gba` file from WeChat files.
5. Tap `横` / `竖` to switch screen orientation.
6. Tap `存` / `读` for instant save and instant load.
7. Tap `速` to cycle frame-skip performance modes.

## Online ROM Configuration

Large ROM files should not be bundled into the code package. For development and testing, upload your ROM to WeChat Cloud Storage or host it at your own HTTPS URL, then update `js/gba/rom-config.js`:

```js
export const ROM_SOURCE = {
  name: 'default.gba',
  cloudEnv: 'your cloud env id',
  cloudFileID: 'cloud://...',
  httpsUrl: '',
  preferHttps: true,
  bundledBiosPath: '',
  biosCloudFileID: '',
  biosHttpsUrl: '',
};
```

Configuration fields:

- `name`: ROM display name.
- `cloudEnv`: WeChat Cloud environment ID.
- `cloudFileID`: ROM fileID in Cloud Storage.
- `httpsUrl`: regular HTTPS ROM download URL.
- `preferHttps`: when `true`, tries `httpsUrl` before Cloud Storage.
- `bundledBiosPath`: optional packaged BIOS path.
- `biosCloudFileID` / `biosHttpsUrl`: optional cloud or HTTPS BIOS source.

If you use a regular HTTPS URL, configure the `downloadFile` legal domain in the WeChat Mini Program console. DevTools can temporarily disable domain checks, but real devices and release builds need the correct domain configuration.

## Local Development ROMs

In WeChat DevTools, tapping `在线` first tries to load the local debug ROM from the `rom` directory. This makes repeated testing faster because it avoids network downloads.

The `rom` directory is only for local development and is ignored by `project.config.json` during upload. Before publishing this repository, do not commit ROM files you do not have the right to distribute.

## BIOS

A real GBA BIOS must be exactly 16KB, or 16384 bytes. For open-source safety, this repository does not include real BIOS data. `js/gba/bundled-bios.js` is intentionally kept as an empty placeholder so imports remain stable.

Users can provide their own legally obtained BIOS by configuring `bundledBiosPath`, `biosCloudFileID`, `biosHttpsUrl`, or by privately replacing the placeholder during local development.

## Saves

There are two save types:

- Battery save: cartridge SRAM/FLASH/EEPROM data, automatically persisted to WeChat local storage.
- Instant state: full emulator state saved and restored through the `存` / `读` buttons.

Save keys are generated from ROM content, so ROMs with the same filename but different contents do not overwrite each other.

## Performance Notes

Mobile performance depends on the device, WeChat runtime, WASM execution speed, and audio output. The project provides frame-skip modes for slower devices:

- Original rendering
- Skip 2 frames
- Skip 4 frames
- Skip 6 frames

On newer phones, the mGBA WASM core can usually approach 60 FPS. Lower-end devices may need frame skip.

## Open Source Checklist

- Remove or replace all commercial ROMs.
- Keep real BIOS files out of git unless you have explicit distribution rights.
- Replace the cloud environment, fileID, and HTTPS URLs in `js/gba/rom-config.js` with your own legal resources, or leave them empty.
- Add an appropriate open source license, such as MIT, GPL, or another license compatible with the emulator core and dependencies.
- Check the `appid` in `project.config.json`, and replace it with your own test AppID if needed.

## Copyright and Disclaimer

This project is intended for learning and research around WeChat Mini Games and GBA emulator porting. Use only ROM and BIOS files that you have the legal right to use. This project does not provide commercial game ROMs and does not encourage or support unauthorized game distribution.

mGBA and related dependencies have their own open source licenses. Before publishing or releasing your project, make sure your license is compatible with all dependencies.
