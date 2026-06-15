import { resizeCanvasToWindow } from './render';
import GBAEmulatorAdapter from './gba/emulator';
import GBAControls from './gba/controls';
import GBALayout from './gba/layout';
import { readLocalRom, readOnlineRom } from './gba/rom';

const ctx = canvas.getContext('2d');

export default class Main {
  constructor() {
    this.layout = new GBALayout(canvas.width, canvas.height);
    this.emulator = new GBAEmulatorAdapter(ctx);
    this.controls = new GBAControls(this.layout, {
      onButtonDown: (button) => this.handleButtonDown(button),
      onButtonUp: (button) => this.emulator.release(button),
      onCommand: (command) => this.handleCommand(command),
      onChange: () => this.requestRender(),
    });
    this.message = '导入 .gba ROM 开始游玩';
    this.status = 'READY';
    this.romName = '';
    this.downloadProgress = -1;
    this.lastProgressRenderTime = 0;
    this.aniId = 0;
    this.fps = 0;
    this.fpsLastTime = Date.now();
    this.fpsLastFrameCount = 0;
    this.lastRenderedFrameCount = -1;
    this.lastRenderTime = 0;
    this.renderDirty = true;

    this.bindTouchEvents();
    this.bindLifecycleEvents();
    this.loop = this.loop.bind(this);
    this.aniId = requestAnimationFrame(this.loop);
  }

  bindTouchEvents() {
    wx.onTouchStart((event) => this.controls.handleTouchStart(event));
    wx.onTouchMove((event) => this.controls.handleTouchMove(event));
    wx.onTouchEnd((event) => this.controls.handleTouchEnd(event));
    wx.onTouchCancel((event) => this.controls.handleTouchCancel(event));
  }

  bindLifecycleEvents() {
    if (wx.onHide) {
      wx.onHide(() => this.emulator.pause());
    }
    if (wx.onShow) {
      wx.onShow(() => {
        this.resizeCanvas();
        if (this.emulator.hasRom() && this.status === 'RUNNING') {
          this.emulator.play();
        }
      });
    }
    if (wx.onWindowResize) {
      wx.onWindowResize(() => this.resizeCanvas());
    }
  }

  async handleCommand(command) {
    if (command === 'online') {
      await this.importRom('online');
      return;
    }
    if (command === 'local') {
      await this.importRom('local');
      return;
    }
    if (command === 'perf') {
      this.cyclePerformanceMode();
      return;
    }
    if (command === 'layout') {
      this.toggleDeviceOrientation();
      return;
    }
    if (command === 'save') {
      this.saveGame();
      return;
    }
    if (command === 'load') {
      this.loadGame();
      return;
    }
    if (command === 'play') {
      this.togglePlay();
      return;
    }
    if (command === 'reset') {
      this.resetGame();
    }
  }

  handleButtonDown(button) {
    this.emulator.press(button);
  }

  saveGame() {
    if (!this.emulator.hasRom()) {
      this.message = '请先导入 ROM';
      this.requestRender();
      return;
    }

    this.message = this.emulator.exportState() ? '即时存档已保存' : '当前还不能保存即时存档';
    this.requestRender();
  }

  loadGame() {
    if (!this.emulator.hasRom()) {
      this.message = '请先导入 ROM';
      this.requestRender();
      return;
    }

    const restored = this.emulator.importStoredState();
    this.status = 'RUNNING';
    if (restored) {
      this.emulator.play();
    }
    this.message = restored ? '即时读档完成' : '没有找到即时存档';
    this.requestRender();
  }

  cyclePerformanceMode() {
    if (!this.emulator.hasRom()) {
      this.message = '请先导入 ROM';
      this.requestRender();
      return;
    }
    const frameSkip = this.emulator.cycleFrameSkip();
    this.message = frameSkip ? `性能模式：跳过 ${frameSkip} 帧` : '性能模式：原始画面';
    this.resetFpsCounter();
    this.requestRender();
  }

  toggleDeviceOrientation() {
    const target = canvas.width > canvas.height ? 'portrait' : 'landscape';
    if (!wx.setDeviceOrientation) {
      this.message = '当前微信版本不支持切换屏幕方向';
      this.requestRender();
      return;
    }

    wx.setDeviceOrientation({
      value: target,
      success: () => {
        this.message = target === 'landscape' ? '已切换横屏' : '已切换竖屏';
        setTimeout(() => this.resizeCanvas(), 120);
      },
      fail: (error) => {
        this.message = error && error.errMsg ? error.errMsg : '切换屏幕方向失败';
        this.requestRender();
      },
    });
  }

  resizeCanvas() {
    resizeCanvasToWindow();
    this.layout.update(canvas.width, canvas.height);
    this.lastRenderedFrameCount = -1;
    this.renderDirty = true;
    this.requestRender();
  }

  async importRom(source = 'online') {
    this.status = 'LOADING';
    this.message = source === 'local' ? '正在选择本地 ROM...' : '正在下载在线 ROM...';
    this.downloadProgress = source === 'online' ? 0 : -1;
    this.requestRender();

    try {
      const rom = source === 'local'
        ? await readLocalRom()
        : await readOnlineRom({
          onProgress: (progress) => this.updateDownloadProgress(progress),
        });
      this.downloadProgress = -1;
      this.message = '正在加载模拟器...';
      this.requestRender();
      await this.emulator.loadRom(rom.data, rom.name, rom.bios);
      this.resetFpsCounter();
      this.romName = rom.name;
      this.status = 'RUNNING';
      this.message = rom.bios ? '已加载 ROM + BIOS' : '运行中';
      this.emulator.setAudioEnabled(true);
      this.emulator.play();
      this.requestRender();
    } catch (error) {
      this.downloadProgress = -1;
      this.status = 'READY';
      this.message = error && error.message ? error.message : 'ROM 导入失败';
      this.requestRender();
      if (wx.showToast) {
        wx.showToast({ title: this.message, icon: 'none' });
      }
    }
  }

  updateDownloadProgress(progress) {
    const percent = Math.max(0, Math.min(100, progress | 0));
    const now = Date.now();
    if (percent === this.downloadProgress && now - this.lastProgressRenderTime < 120) {
      return;
    }
    this.downloadProgress = percent;
    this.lastProgressRenderTime = now;
    this.message = `正在下载在线 ROM ${percent}%`;
    this.requestRender();
  }

  togglePlay() {
    if (!this.emulator.hasRom()) {
      this.importRom('online');
      return;
    }

    if (this.emulator.isPaused()) {
      this.status = 'RUNNING';
      this.message = '运行中';
      this.emulator.play();
      this.requestRender();
    } else {
      this.status = 'PAUSED';
      this.message = '已暂停';
      this.emulator.pause();
      this.requestRender();
    }
  }

  resetGame() {
    if (!this.emulator.hasRom()) {
      this.message = '请先导入 ROM';
      this.requestRender();
      return;
    }

    this.emulator.restart();
    this.status = 'RUNNING';
    this.message = '已重启';
    this.requestRender();
  }

  render() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.layout.update(canvas.width, canvas.height);
    this.layout.drawShell(ctx);
    this.emulator.drawFrame(this.layout.screen);
    this.layout.drawOverlay(ctx, {
      status: this.status,
      message: this.message,
      romName: this.romName,
      fps: this.fps,
      speed: this.emulator.speedText,
      frameSkip: this.emulator.getFrameSkip(),
      paused: this.emulator.isPaused(),
    });
    this.controls.render(ctx);
    this.lastRenderedFrameCount = this.emulator.getFrameCount();
    this.lastRenderTime = Date.now();
    this.renderDirty = false;
  }

  loop() {
    if (this.updateFps()) {
      this.requestRender();
    }
    if (this.shouldRender()) {
      this.render();
    }
    this.aniId = requestAnimationFrame(this.loop);
  }

  updateFps() {
    const now = Date.now();
    const elapsed = now - this.fpsLastTime;
    if (elapsed < 1000) {
      return false;
    }

    const frameCount = this.emulator.getEmulatedFrameCount();
    this.fps = Math.round((frameCount - this.fpsLastFrameCount) * 1000 / elapsed);
    this.fpsLastFrameCount = frameCount;
    this.fpsLastTime = now;
    return true;
  }

  resetFpsCounter() {
    this.fps = 0;
    this.fpsLastTime = Date.now();
    this.fpsLastFrameCount = this.emulator.getEmulatedFrameCount();
  }

  requestRender() {
    this.renderDirty = true;
  }

  shouldRender() {
    const frameCount = this.emulator.getFrameCount();
    const hasNewFrame = frameCount !== this.lastRenderedFrameCount;
    const needsIdleRefresh = Date.now() - this.lastRenderTime > 500;
    return this.renderDirty || hasNewFrame || needsIdleRefresh;
  }
}
