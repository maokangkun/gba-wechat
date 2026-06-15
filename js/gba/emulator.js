import WechatAudioSink from './audio';

const createMGBAModule = require('./wasm/mgba-wechat.js');

const GBA_WIDTH = 240;
const GBA_HEIGHT = 160;
const GBA_PIXELS = GBA_WIDTH * GBA_HEIGHT;
const GBA_FRAME_MS = 1000 / 59.7275;
const WASM_PATH = 'js/gba/wasm/mgba-wechat.wasm';

const KEY_BITS = {
  a: 0,
  b: 1,
  select: 2,
  start: 3,
  right: 4,
  left: 5,
  up: 6,
  down: 7,
  r: 8,
  l: 9,
};

const SAVE_PREFIX = 'gba-save-v2:';
const LEGACY_SAVE_PREFIX = 'gba-save-v1:';
const STATE_PREFIX = 'gba-state-v1:';
const SAVE_INTERVAL_FRAMES = 300;

let wasmModulePromise = null;

function ensureRuntimeShims() {
  const root = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;

  if (!globalThis.document) {
    globalThis.document = {
      currentScript: null,
      hidden: false,
      msHidden: false,
      mozHidden: false,
      webkitHidden: false,
    };
  }
  if (!root.document) {
    root.document = globalThis.document;
  }
  if (!root.performance) {
    root.performance = { now: () => Date.now() };
  }
  if (!globalThis.performance) {
    globalThis.performance = root.performance;
  }
  if (!root.crypto) {
    root.crypto = {
      getRandomValues: (target) => {
        for (let i = 0; i < target.length; i++) {
          target[i] = Math.floor(Math.random() * 256);
        }
        return target;
      },
    };
  }
  if (!globalThis.crypto) {
    globalThis.crypto = root.crypto;
  }
  if (!root.WebAssembly && typeof WXWebAssembly !== 'undefined') {
    root.WebAssembly = WXWebAssembly;
  }
  if (!globalThis.WebAssembly && root.WebAssembly) {
    globalThis.WebAssembly = root.WebAssembly;
  }
}

function toUint8Array(data) {
  if (data instanceof Uint8Array) {
    return data;
  }
  if (data instanceof ArrayBuffer) {
    return new Uint8Array(data);
  }
  if (data && data.buffer instanceof ArrayBuffer) {
    return new Uint8Array(data.buffer, data.byteOffset || 0, data.byteLength || data.length);
  }
  return new Uint8Array(data || []);
}

function bytesToBase64(bytes) {
  if (typeof wx !== 'undefined' && wx.arrayBufferToBase64) {
    const copy = new Uint8Array(bytes.length);
    copy.set(bytes);
    return wx.arrayBufferToBase64(copy.buffer);
  }

  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  const root = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
  return root.btoa(binary);
}

function base64ToBytes(base64) {
  if (!base64) {
    return null;
  }
  if (typeof wx !== 'undefined' && wx.base64ToArrayBuffer) {
    return new Uint8Array(wx.base64ToArrayBuffer(base64));
  }

  const root = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
  const binary = root.atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i) & 0xFF;
  }
  return bytes;
}

function hashRom(bytes) {
  let hash = 0x811C9DC5;
  for (let i = 0; i < bytes.length; i++) {
    hash ^= bytes[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

function makeSaveKey(bytes) {
  const id = `${bytes.length}:${hashRom(bytes)}`;
  return `${SAVE_PREFIX}${id}`;
}

function makeStateKey(bytes) {
  const id = `${bytes.length}:${hashRom(bytes)}`;
  return `${STATE_PREFIX}${id}`;
}

function makeLegacySaveKey(name) {
  return `${LEGACY_SAVE_PREFIX}${encodeURIComponent(name || 'game')}`;
}

function readPackageFile(path) {
  const fs = wx.getFileSystemManager && wx.getFileSystemManager();
  if (!fs) {
    return Promise.reject(new Error('文件系统不可用，无法读取 WASM 核心'));
  }

  return new Promise((resolve, reject) => {
    fs.readFile({
      filePath: path,
      success: (result) => resolve(result.data),
      fail: (error) => reject(new Error(`读取 WASM 核心失败: ${error.errMsg || ''}`)),
    });
  });
}

function getWXWebAssembly() {
  const root = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
  if (root.WXWebAssembly) {
    return root.WXWebAssembly;
  }
  if (typeof WXWebAssembly !== 'undefined') {
    return WXWebAssembly;
  }
  return null;
}

function instantiateWechatWasm(imports, success, failure) {
  const wxWasm = getWXWebAssembly();
  if (!wxWasm || !wxWasm.instantiate) {
    return false;
  }

  try {
    const result = wxWasm.instantiate(WASM_PATH, imports);
    if (result && typeof result.then === 'function') {
      result.then((value) => {
        const instance = value && value.instance ? value.instance : value;
        success(instance, value && value.module);
      }).catch(failure);
      return true;
    }
    const instance = result && result.instance ? result.instance : result;
    success(instance, result && result.module);
    return true;
  } catch (error) {
    failure(error);
    return true;
  }
}

function instantiateBinaryWasm(imports, success, failure) {
  if (!globalThis.WebAssembly || !globalThis.WebAssembly.instantiate) {
    failure(new Error('当前微信运行时不支持 WebAssembly'));
    return;
  }
  readPackageFile(WASM_PATH)
    .then((data) => globalThis.WebAssembly.instantiate(toUint8Array(data), imports))
    .then((value) => {
      const instance = value && value.instance ? value.instance : value;
      success(instance, value && value.module);
    })
    .catch(failure);
}

async function loadWasmModule() {
  ensureRuntimeShims();
  if (!wasmModulePromise) {
    const wxWasm = getWXWebAssembly();
    if (wxWasm) {
      wasmModulePromise = createMGBAModule({
        noFSInit: true,
        print: () => {},
        printErr: (message) => console.warn('[mGBA]', message),
        instantiateWasm: (imports, success) => {
          instantiateWechatWasm(imports, success, (error) => {
            console.warn('[mGBA] WXWebAssembly instantiate failed, trying binary instantiate', error);
            instantiateBinaryWasm(imports, success, (fallbackError) => {
              console.error('[mGBA] WASM instantiate failed', fallbackError);
            });
          });
          return {};
        },
      });
    } else {
      wasmModulePromise = readPackageFile(WASM_PATH).then((data) => {
        const wasmBinary = toUint8Array(data);
        return createMGBAModule({
          wasmBinary,
          noFSInit: true,
          print: () => {},
          printErr: (message) => console.warn('[mGBA]', message),
        });
      });
    }
  }
  return wasmModulePromise;
}

export default class GBAEmulatorAdapter {
  constructor(ctx) {
    ensureRuntimeShims();
    this.ctx = ctx;
    this.module = null;
    this.romLoaded = false;
    this.paused = true;
    this.gameName = '';
    this.speedText = '';
    this.frameCount = 0;
    this.coreFrameCount = 0;
    this.frameSkip = 0;
    this.frameImage = ctx.createImageData(GBA_WIDTH, GBA_HEIGHT);
    this.scaledFrame = null;
    this.scaledFrameWidth = 0;
    this.scaledFrameHeight = 0;
    this.scaledFrameSourceCount = -1;
    this.frameReady = false;
    this.audio = new WechatAudioSink();
    this.audioEnabled = true;
    this.keyMask = 0;
    this.romPtr = 0;
    this.romSize = 0;
    this.biosPtr = 0;
    this.biosSize = 0;
    this.saveRestorePtr = 0;
    this.saveRestoreSize = 0;
    this.saveKey = '';
    this.legacySaveKey = '';
    this.stateRestorePtr = 0;
    this.stateRestoreSize = 0;
    this.stateKey = '';
    this.lastSaveFrame = 0;
    this.rafId = 0;
    this.lastTick = 0;
    this.frameBudget = 0;
  }

  async loadRom(data, name, biosData) {
    const rom = toUint8Array(data);
    if (!rom.length) {
      throw new Error('ROM 文件为空');
    }

    const bios = toUint8Array(biosData);
    const mod = await loadWasmModule();
    this.releaseCoreMemory();
    this.module = mod;

    this.romPtr = mod._malloc(rom.length);
    this.romSize = rom.length;
    mod.HEAPU8.set(rom, this.romPtr);

    if (bios.length === 0x4000) {
      this.biosPtr = mod._malloc(bios.length);
      this.biosSize = bios.length;
      mod.HEAPU8.set(bios, this.biosPtr);
    }

    const loaded = mod._gba_load_rom(this.romPtr, this.romSize, this.biosPtr, this.biosSize);
    if (!loaded) {
      this.releaseCoreMemory();
      throw new Error('mGBA 加载 ROM 失败');
    }

    this.gameName = name || 'GAME';
    this.saveKey = makeSaveKey(rom);
    this.legacySaveKey = makeLegacySaveKey(this.gameName);
    this.stateKey = makeStateKey(rom);
    this.romLoaded = true;
    this.paused = true;
    this.frameReady = false;
    this.frameCount = 0;
    this.coreFrameCount = 0;
    this.scaledFrameSourceCount = -1;
    this.keyMask = 0;
    mod._gba_set_keys(0);
    this.importStoredSave();
    this.applyAudioState();
  }

  hasRom() {
    return this.romLoaded;
  }

  isPaused() {
    return this.paused;
  }

  play() {
    if (!this.romLoaded || !this.module) {
      return;
    }
    this.paused = false;
    this.lastTick = 0;
    this.frameBudget = 0;
    this.scheduleFrame();
  }

  pause() {
    this.exportSave();
    this.paused = true;
    if (this.rafId && typeof cancelAnimationFrame === 'function') {
      cancelAnimationFrame(this.rafId);
    }
    this.rafId = 0;
  }

  restart() {
    if (!this.romLoaded || !this.module) {
      return;
    }
    this.exportSave();
    this.module._gba_reset();
    this.importStoredSave();
    this.keyMask = 0;
    this.frameReady = false;
    this.frameCount = 0;
    this.coreFrameCount = 0;
    this.scaledFrameSourceCount = -1;
    this.play();
  }

  loadStoredSaveAndRestart() {
    if (!this.romLoaded || !this.module) {
      return false;
    }

    this.module._gba_reset();
    const restored = this.importStoredSave();
    this.keyMask = 0;
    this.module._gba_set_keys(0);
    this.frameReady = false;
    this.frameCount = 0;
    this.coreFrameCount = 0;
    this.scaledFrameSourceCount = -1;
    this.play();
    return restored;
  }

  press(button) {
    this.setButton(button, true);
  }

  release(button) {
    this.setButton(button, false);
  }

  setButton(button, pressed) {
    if (!this.romLoaded || !this.module || KEY_BITS[button] === undefined) {
      return;
    }
    const bit = 1 << KEY_BITS[button];
    this.keyMask = pressed ? (this.keyMask | bit) : (this.keyMask & ~bit);
    this.module._gba_set_keys(this.keyMask);
  }

  cycleFrameSkip() {
    const levels = [0, 1, 2, 4, 6];
    const index = levels.indexOf(this.frameSkip);
    this.frameSkip = levels[(index + 1) % levels.length];
    return this.frameSkip;
  }

  getFrameSkip() {
    return this.frameSkip;
  }

  setAudioEnabled(enabled) {
    this.audioEnabled = !!enabled;
    this.applyAudioState();
  }

  toggleAudio() {
    this.setAudioEnabled(!this.audioEnabled);
    return this.audioEnabled;
  }

  isAudioSupported() {
    return true;
  }

  isAudioEnabled() {
    return this.audioEnabled;
  }

  applyAudioState() {
    if (!this.module || !this.romLoaded) {
      return;
    }
    if (!this.audioEnabled) {
      this.audio.unregister();
      return;
    }
    if (!this.audio.context) {
      const sampleRate = this.module._gba_get_audio_sample_rate
        ? this.module._gba_get_audio_sample_rate()
        : 32768;
      this.audio.initialize(2, sampleRate, 4096, 1, () => {
        this.audioEnabled = false;
      });
    }
    this.audio.register();
  }

  scheduleFrame() {
    if (this.rafId || this.paused) {
      return;
    }
    this.rafId = requestAnimationFrame((time) => this.tick(time || Date.now()));
  }

  tick(time) {
    this.rafId = 0;
    if (this.paused || !this.romLoaded || !this.module) {
      return;
    }

    if (!this.lastTick) {
      this.lastTick = time;
      this.frameBudget = GBA_FRAME_MS;
    } else {
      this.frameBudget += Math.min(time - this.lastTick, GBA_FRAME_MS * 4);
      this.lastTick = time;
    }

    let frames = 0;
    while (this.frameBudget >= GBA_FRAME_MS && frames < 4) {
      this.runFrame();
      this.frameBudget -= GBA_FRAME_MS;
      frames++;
    }
    if (frames === 0) {
      this.runFrame();
    }

    this.scheduleFrame();
  }

  runFrame() {
    this.module._gba_run_frame();
    this.coreFrameCount++;
    if (this.coreFrameCount - this.lastSaveFrame >= SAVE_INTERVAL_FRAMES) {
      this.exportSave();
    }
    if (this.frameSkip && (this.coreFrameCount % (this.frameSkip + 1)) !== 0) {
      this.pullAudio();
      return;
    }
    this.pullAudio();
    this.receiveFrame();
  }

  pullAudio() {
    if (!this.audioEnabled || !this.audio || !this.audio.enabled || !this.module._gba_pull_audio) {
      return;
    }

    const frames = this.module._gba_pull_audio();
    if (!frames) {
      return;
    }
    const ptr = this.module._gba_get_audio_ptr();
    const samples = new Float32Array(this.module.HEAPU8.buffer, ptr, frames * 2);
    this.audio.push(samples);
  }

  receiveFrame() {
    const ptr = this.module._gba_get_frame_ptr();
    const size = this.module._gba_get_frame_size();
    if (!ptr || size < GBA_PIXELS * 4) {
      return;
    }
    this.frameImage.data.set(this.module.HEAPU8.subarray(ptr, ptr + GBA_PIXELS * 4));
    this.frameCount++;
    this.frameReady = true;
  }

  drawFrame(rect) {
    this.ctx.save();
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.fillStyle = '#101418';
    this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);

    if (this.frameReady) {
      this.drawScaledFrame(rect);
    } else {
      this.drawBootScreen(rect);
    }
    this.ctx.restore();
  }

  getFrameCount() {
    return this.frameCount;
  }

  getEmulatedFrameCount() {
    return this.coreFrameCount;
  }

  drawScaledFrame(rect) {
    const width = Math.max(1, Math.round(rect.width));
    const height = Math.max(1, Math.round(rect.height));
    const x = Math.round(rect.x);
    const y = Math.round(rect.y);

    if (!this.scaledFrame || this.scaledFrameWidth !== width || this.scaledFrameHeight !== height) {
      this.scaledFrame = this.ctx.createImageData(width, height);
      this.scaledFrameWidth = width;
      this.scaledFrameHeight = height;
      this.scaledFrameSourceCount = -1;
    }

    if (this.scaledFrameSourceCount !== this.frameCount) {
      const source = this.frameImage.data;
      const target = this.scaledFrame.data;

      for (let dy = 0; dy < height; dy++) {
        const sy = Math.min(GBA_HEIGHT - 1, Math.floor(dy * GBA_HEIGHT / height));
        for (let dx = 0; dx < width; dx++) {
          const sx = Math.min(GBA_WIDTH - 1, Math.floor(dx * GBA_WIDTH / width));
          const src = ((sy * GBA_WIDTH + sx) << 2);
          const dst = ((dy * width + dx) << 2);
          target[dst] = source[src];
          target[dst + 1] = source[src + 1];
          target[dst + 2] = source[src + 2];
          target[dst + 3] = 255;
        }
      }
      this.scaledFrameSourceCount = this.frameCount;
    }

    this.ctx.putImageData(this.scaledFrame, x, y);
  }

  drawBootScreen(rect) {
    this.ctx.fillStyle = '#dce4d9';
    this.ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
    this.ctx.fillStyle = '#26312c';
    this.ctx.font = 'bold 18px sans-serif';
    this.ctx.textAlign = 'center';
    this.ctx.fillText('GAME BOY ADVANCE', rect.x + rect.width / 2, rect.y + rect.height / 2 - 8);
    this.ctx.font = '12px sans-serif';
    this.ctx.fillText('IMPORT ROM', rect.x + rect.width / 2, rect.y + rect.height / 2 + 18);
  }

  importStoredSave() {
    if (!this.module || !this.saveKey || !wx.getStorageSync || !this.module._gba_import_save) {
      return false;
    }

    let base64 = '';
    try {
      base64 = wx.getStorageSync(this.saveKey) || (this.legacySaveKey ? wx.getStorageSync(this.legacySaveKey) : '');
    } catch (error) {
      return false;
    }
    const save = base64ToBytes(base64);
    if (!save || !save.length) {
      return false;
    }

    if (this.saveRestorePtr) {
      this.module._free(this.saveRestorePtr);
      this.saveRestorePtr = 0;
      this.saveRestoreSize = 0;
    }
    this.saveRestorePtr = this.module._malloc(save.length);
    this.saveRestoreSize = save.length;
    this.module.HEAPU8.set(save, this.saveRestorePtr);
    const restored = !!this.module._gba_import_save(this.saveRestorePtr, this.saveRestoreSize);
    if (restored && this.legacySaveKey) {
      try {
        wx.setStorageSync(this.saveKey, base64);
      } catch (error) {}
    }
    return restored;
  }

  exportSave() {
    if (!this.module || !this.romLoaded || !this.saveKey || !wx.setStorageSync || !this.module._gba_export_save) {
      return false;
    }

    const size = this.module._gba_export_save();
    const ptr = this.module._gba_get_save_ptr && this.module._gba_get_save_ptr();
    if (!size || !ptr) {
      return false;
    }

    try {
      const bytes = this.module.HEAPU8.subarray(ptr, ptr + size);
      const base64 = bytesToBase64(bytes);
      wx.setStorageSync(this.saveKey, base64);
      if (this.legacySaveKey) {
        wx.setStorageSync(this.legacySaveKey, base64);
      }
      this.lastSaveFrame = this.coreFrameCount;
      return true;
    } catch (error) {
      return false;
    }
  }

  importStoredState() {
    if (!this.module || !this.stateKey || !wx.getStorageSync || !this.module._gba_import_state) {
      return false;
    }

    let base64 = '';
    try {
      base64 = wx.getStorageSync(this.stateKey);
    } catch (error) {
      return false;
    }
    const state = base64ToBytes(base64);
    if (!state || !state.length) {
      return false;
    }

    if (this.stateRestorePtr) {
      this.module._free(this.stateRestorePtr);
      this.stateRestorePtr = 0;
      this.stateRestoreSize = 0;
    }
    this.stateRestorePtr = this.module._malloc(state.length);
    this.stateRestoreSize = state.length;
    this.module.HEAPU8.set(state, this.stateRestorePtr);
    const restored = !!this.module._gba_import_state(this.stateRestorePtr, this.stateRestoreSize);
    if (restored) {
      this.keyMask = 0;
      this.module._gba_set_keys(0);
      this.frameReady = false;
      this.scaledFrameSourceCount = -1;
      this.receiveFrame();
      this.lastTick = 0;
      this.frameBudget = 0;
      this.applyAudioState();
    }
    return restored;
  }

  exportState() {
    if (!this.module || !this.romLoaded || !this.stateKey || !wx.setStorageSync || !this.module._gba_export_state) {
      return false;
    }

    const size = this.module._gba_export_state();
    const ptr = this.module._gba_get_state_ptr && this.module._gba_get_state_ptr();
    if (!size || !ptr) {
      return false;
    }

    try {
      const bytes = this.module.HEAPU8.subarray(ptr, ptr + size);
      wx.setStorageSync(this.stateKey, bytesToBase64(bytes));
      this.exportSave();
      return true;
    } catch (error) {
      return false;
    }
  }

  releaseCoreMemory() {
    this.exportSave();
    this.pause();
    if (this.module && this.romLoaded) {
      this.module._gba_unload();
    }
    if (this.module && this.romPtr) {
      this.module._free(this.romPtr);
    }
    if (this.module && this.biosPtr) {
      this.module._free(this.biosPtr);
    }
    if (this.module && this.saveRestorePtr) {
      this.module._free(this.saveRestorePtr);
    }
    if (this.module && this.stateRestorePtr) {
      this.module._free(this.stateRestorePtr);
    }
    this.audio.unregister();
    this.romPtr = 0;
    this.romSize = 0;
    this.biosPtr = 0;
    this.biosSize = 0;
    this.saveRestorePtr = 0;
    this.saveRestoreSize = 0;
    this.saveKey = '';
    this.legacySaveKey = '';
    this.stateRestorePtr = 0;
    this.stateRestoreSize = 0;
    this.stateKey = '';
    this.lastSaveFrame = 0;
    this.romLoaded = false;
  }
}
