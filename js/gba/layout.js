const GBA_ASPECT = 240 / 160;

function roundedRect(ctx, x, y, width, height, radius) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + width, y, x + width, y + height, r);
  ctx.arcTo(x + width, y + height, x, y + height, r);
  ctx.arcTo(x, y + height, x, y, r);
  ctx.arcTo(x, y, x + width, y, r);
  ctx.closePath();
}

function fitRect(maxWidth, maxHeight, aspect) {
  let width = maxWidth;
  let height = width / aspect;
  if (height > maxHeight) {
    height = maxHeight;
    width = height * aspect;
  }
  return { width, height };
}

function getTopInset() {
  let safeTop = 0;
  let menuBottom = 0;

  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    safeTop = info.safeArea ? info.safeArea.top : info.statusBarHeight || 0;
  } catch (error) {
    safeTop = 0;
  }

  try {
    if (wx.getMenuButtonBoundingClientRect) {
      const menu = wx.getMenuButtonBoundingClientRect();
      menuBottom = menu.bottom || 0;
    }
  } catch (error) {
    menuBottom = 0;
  }

  return Math.max(20, safeTop + 8, menuBottom + 10);
}

export default class GBALayout {
  constructor(width, height) {
    this.update(width, height);
  }

  update(width, height) {
    this.width = width;
    this.height = height;
    if (width > height) {
      this.updateLandscape(width, height);
      return;
    }
    this.updatePortrait(width, height);
  }

  updatePortrait(width, height) {
    const outerMargin = Math.max(12, Math.min(width, height) * 0.035);
    const top = getTopInset();
    const body = {
      x: outerMargin,
      y: top,
      width: width - outerMargin * 2,
      height: height - top - outerMargin,
    };
    this.body = body;

    const inner = Math.max(14, body.width * 0.045);
    const commandY = body.y + 14;
    const compactCommands = body.width < 320;
    const screenTop = commandY + (compactCommands ? 72 : 42);
    const screenMaxHeight = Math.min(body.height * 0.34, (body.width - inner * 2 - 20) / GBA_ASPECT);
    const screenSize = fitRect(body.width - inner * 2 - 20, screenMaxHeight, GBA_ASPECT);

    this.screenBezel = {
      x: body.x + (body.width - screenSize.width) / 2 - 10,
      y: screenTop,
      width: screenSize.width + 20,
      height: screenSize.height + 32,
    };
    this.screen = {
      x: body.x + (body.width - screenSize.width) / 2,
      y: screenTop + 14,
      width: screenSize.width,
      height: screenSize.height,
    };
    this.statusBar = {
      x: this.screenBezel.x + 8,
      y: this.screenBezel.y + this.screenBezel.height + 7,
      width: this.screenBezel.width - 16,
      height: 18,
    };

    const controlsTop = this.statusBar.y + this.statusBar.height + 70;
    const controlsBottom = body.y + body.height - 26;
    const available = Math.max(190, controlsBottom - controlsTop);
    const compactControls = available < 250;
    const unit = Math.min(body.width / 8.2, available / (compactControls ? 6.2 : 4.15), 48);
    const shoulderHeight = Math.max(24, unit * 0.56);
    const shoulderWidth = Math.max(78, unit * 1.9);
    const shoulderY = controlsTop;
    const mainY = controlsTop + available * (compactControls ? 0.46 : 0.5);
    const systemY = controlsTop + available * (compactControls ? 0.24 : 0.16);
    const dpadCenter = {
      x: body.x + inner + unit * 1.35,
      y: mainY,
    };
    const actionCenter = {
      x: body.x + body.width - inner - unit * 1.45,
      y: mainY,
    };
    const commandGap = 4;
    const commandRow2Y = commandY + 34;
    const rightCommandWidth = 32 + commandGap + 34 + commandGap + 34 + commandGap + 34 + commandGap + 38 + commandGap + 38;
    const compactCommandWidth = 34 + commandGap + 34 + commandGap + 34 + commandGap + 38 + commandGap + 38;
    const rightCommandX = compactCommands
      ? body.x + body.width - inner - compactCommandWidth
      : body.x + body.width - inner - rightCommandWidth;
    const layoutCommand = compactCommands
      ? { command: 'layout', label: '横', rect: { x: body.x + inner + 108, y: commandY, width: 34, height: 30 } }
      : { command: 'layout', label: '横', rect: { x: rightCommandX + 2, y: commandY, width: 34, height: 30 } };
    const toolY = compactCommands ? commandRow2Y : commandY;
    const toolOffset = compactCommands ? 0 : 36;

    this.controls = {
      commands: [
        { command: 'online', label: '在线', rect: { x: body.x + inner, y: commandY, width: 40, height: 30 } },
        { command: 'local', label: '本地', rect: { x: body.x + inner + 46, y: commandY, width: 40, height: 30 } },
        layoutCommand,
        { command: 'perf', label: '速', rect: { x: rightCommandX + toolOffset + 4, y: toolY, width: 34, height: 30 } },
        { command: 'save', label: '存', rect: { x: rightCommandX + toolOffset + 42, y: toolY, width: 34, height: 30 } },
        { command: 'load', label: '读', rect: { x: rightCommandX + toolOffset + 80, y: toolY, width: 34, height: 30 } },
        { command: 'play', label: '>', rect: { x: rightCommandX + toolOffset + 118, y: toolY, width: 34, height: 30 } },
        { command: 'reset', label: '↻', rect: { x: rightCommandX + toolOffset + 156, y: toolY, width: 34, height: 30 } },
      ],
      dpad: {
        center: dpadCenter,
        size: unit,
        bounds: { x: dpadCenter.x, y: dpadCenter.y, radius: unit * 1.36 },
      },
      buttons: [
        { key: 'b', label: 'B', x: actionCenter.x - unit * 0.7, y: actionCenter.y + unit * 0.56, radius: unit * 0.58 },
        { key: 'a', label: 'A', x: actionCenter.x + unit * 0.58, y: actionCenter.y - unit * 0.22, radius: unit * 0.58 },
      ],
      shoulders: [
        { key: 'l', label: 'L', rect: { x: body.x + inner, y: shoulderY, width: shoulderWidth, height: shoulderHeight } },
        { key: 'r', label: 'R', rect: { x: body.x + body.width - inner - shoulderWidth, y: shoulderY, width: shoulderWidth, height: shoulderHeight } },
      ],
      system: [
        { key: 'select', label: 'SELECT', rect: { x: body.x + body.width / 2 - unit * 1.55, y: systemY, width: unit * 1.28, height: unit * 0.44 } },
        { key: 'start', label: 'START', rect: { x: body.x + body.width / 2 + unit * 0.27, y: systemY, width: unit * 1.28, height: unit * 0.44 } },
      ],
    };
  }

  updateLandscape(width, height) {
    const outerMargin = Math.max(10, Math.min(width, height) * 0.035);
    const top = getTopInset();
    const body = {
      x: outerMargin,
      y: top,
      width: width - outerMargin * 2,
      height: height - top - outerMargin,
    };
    this.body = body;

    const inner = Math.max(10, Math.min(body.width, body.height) * 0.045);
    const commandY = body.y + 12;
    const commandHeight = 28;
    const compactCommands = body.width < 500;
    const playAreaTop = commandY + (compactCommands ? 64 : commandHeight + 12);
    const playAreaBottom = body.y + body.height - 20;
    const playAreaHeight = Math.max(190, playAreaBottom - playAreaTop);
    const sideWidth = Math.max(112, Math.min(body.width * 0.25, 180));
    const centerX = body.x + body.width / 2;
    const screenMaxWidth = Math.max(160, body.width - sideWidth * 2 - inner * 2);
    const screenMaxHeight = Math.max(110, playAreaHeight - 46);
    const screenSize = fitRect(screenMaxWidth, screenMaxHeight, GBA_ASPECT);
    const screenY = Math.max(
      playAreaTop + 2,
      playAreaTop + Math.max(0, (playAreaHeight - screenSize.height - 28) / 2) - 12,
    );

    this.screenBezel = {
      x: centerX - screenSize.width / 2 - 10,
      y: screenY,
      width: screenSize.width + 20,
      height: screenSize.height + 32,
    };
    this.screen = {
      x: centerX - screenSize.width / 2,
      y: screenY + 14,
      width: screenSize.width,
      height: screenSize.height,
    };
    this.statusBar = {
      x: this.screenBezel.x + 8,
      y: this.screenBezel.y + this.screenBezel.height + 6,
      width: this.screenBezel.width - 16,
      height: 18,
    };

    const unit = Math.min(sideWidth / 3.2, playAreaHeight / 4.4, 46);
    const shoulderHeight = Math.max(24, unit * 0.56);
    const shoulderWidth = Math.max(72, unit * 1.9);
    const sideControlsOffsetY = Math.min(22, Math.max(12, playAreaHeight * 0.055));
    const dpadCenter = {
      x: body.x + inner + sideWidth / 2,
      y: playAreaTop + playAreaHeight * 0.52 + sideControlsOffsetY,
    };
    const actionCenter = {
      x: body.x + body.width - inner - sideWidth / 2 + Math.min(18, unit * 0.42),
      y: playAreaTop + playAreaHeight * 0.52 + sideControlsOffsetY,
    };
    const systemButtonWidth = Math.max(54, unit * 1.45);
    const systemButtonHeight = Math.max(18, unit * 0.46);
    const systemY = Math.min(
      dpadCenter.y - unit * 1.64,
      playAreaBottom - systemButtonHeight - 8,
    );
    const selectX = Math.min(
      dpadCenter.x + unit * 1.95,
      this.screenBezel.x - systemButtonWidth - 12,
    );
    const startX = Math.max(
      actionCenter.x - unit * 1.95 - systemButtonWidth,
      this.screenBezel.x + this.screenBezel.width + 12,
    );
    const commandGap = 5;
    const commandX = body.x + inner;
    const commandRow2Y = commandY + 32;
    const toolY = compactCommands ? commandRow2Y : commandY;
    const toolWidth = 194;
    const toolStartX = compactCommands
      ? body.x + body.width - inner - 194
      : body.x + body.width - inner - toolWidth;

    this.controls = {
      commands: [
        { command: 'online', label: '在线', rect: { x: commandX, y: commandY, width: 46, height: commandHeight } },
        { command: 'local', label: '本地', rect: { x: commandX + 51, y: commandY, width: 46, height: commandHeight } },
        { command: 'layout', label: '竖', rect: { x: toolStartX - 32, y: commandY, width: 32, height: commandHeight } },
        { command: 'perf', label: '速', rect: { x: toolStartX + 4, y: toolY, width: 34, height: commandHeight } },
        { command: 'save', label: '存', rect: { x: toolStartX + 42, y: toolY, width: 34, height: commandHeight } },
        { command: 'load', label: '读', rect: { x: toolStartX + 80, y: toolY, width: 34, height: commandHeight } },
        { command: 'play', label: '>', rect: { x: toolStartX + 118, y: toolY, width: 34, height: commandHeight } },
        { command: 'reset', label: '↻', rect: { x: toolStartX + 156, y: toolY, width: 34, height: commandHeight } },
      ],
      dpad: {
        center: dpadCenter,
        size: unit,
        bounds: { x: dpadCenter.x, y: dpadCenter.y, radius: unit * 1.36 },
      },
      buttons: [
        { key: 'b', label: 'B', x: actionCenter.x - unit * 0.72, y: actionCenter.y + unit * 0.72, radius: unit * 0.58 },
        { key: 'a', label: 'A', x: actionCenter.x + unit * 0.58, y: actionCenter.y - unit * 0.38, radius: unit * 0.58 },
      ],
      shoulders: [
        { key: 'l', label: 'L', rect: { x: dpadCenter.x - shoulderWidth / 2, y: playAreaTop + 6 + sideControlsOffsetY * 0.45, width: shoulderWidth, height: shoulderHeight } },
        { key: 'r', label: 'R', rect: { x: actionCenter.x - shoulderWidth / 2 - Math.min(18, unit * 0.42), y: playAreaTop + 6 + sideControlsOffsetY * 0.45, width: shoulderWidth, height: shoulderHeight } },
      ],
      system: [
        { key: 'select', label: 'SELECT', rect: { x: selectX, y: systemY, width: systemButtonWidth, height: systemButtonHeight } },
        { key: 'start', label: 'START', rect: { x: startX, y: systemY, width: systemButtonWidth, height: systemButtonHeight } },
      ],
    };
  }

  drawShell(ctx) {
    const gradient = ctx.createLinearGradient(0, 0, 0, this.height);
    gradient.addColorStop(0, '#eef1e8');
    gradient.addColorStop(0.55, '#d8ddd2');
    gradient.addColorStop(1, '#bfc7bd');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, this.width, this.height);

    const body = this.body;
    roundedRect(ctx, body.x, body.y, body.width, body.height, 28);
    ctx.fillStyle = '#d8ddd4';
    ctx.fill();
    ctx.strokeStyle = '#8c978f';
    ctx.lineWidth = 2;
    ctx.stroke();

    const bezel = this.screenBezel;
    roundedRect(ctx, bezel.x, bezel.y, bezel.width, bezel.height, 14);
    ctx.fillStyle = '#31363c';
    ctx.fill();

    ctx.fillStyle = '#aabab0';
    ctx.font = 'bold 11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText('NINTENDO', bezel.x + 16, bezel.y + bezel.height - 8);
    ctx.textAlign = 'right';
    ctx.fillText('GBA', bezel.x + bezel.width - 16, bezel.y + bezel.height - 8);
  }

  drawOverlay(ctx, state) {
    const screen = this.screen;
    const status = this.statusBar;
    const statusText = {
      READY: '就绪',
      LOADING: '加载中',
      RUNNING: '运行中',
      PAUSED: '已暂停',
    }[state.status] || state.status;
    const fpsText = state.romName ? `${state.fps || 0}FPS` : '';
    const speedText = state.speed || '';
    const skipText = state.romName && state.frameSkip ? `跳${state.frameSkip}` : '';
    const rightText = [fpsText, statusText, skipText, speedText].filter(Boolean).join(' ');

    ctx.fillStyle = '#213129';
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    ctx.fillText(state.romName || 'NO ROM', status.x, status.y + 13);
    ctx.textAlign = 'right';
    ctx.fillText(rightText, status.x + status.width, status.y + 13);

    if (!state.romName || state.paused) {
      ctx.save();
      ctx.globalAlpha = 0.78;
      ctx.fillStyle = '#111820';
      roundedRect(ctx, screen.x + 14, screen.y + screen.height - 46, screen.width - 28, 30, 6);
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#f4f7ef';
      ctx.textAlign = 'center';
      ctx.font = '13px sans-serif';
      ctx.fillText(state.message, screen.x + screen.width / 2, screen.y + screen.height - 27);
      ctx.restore();
    }
  }

  drawControls(ctx, activeButtons) {
    this.drawDpad(ctx, activeButtons);
    this.controls.shoulders.forEach((button) => this.drawShoulderButton(ctx, button, activeButtons[button.key]));
    this.controls.buttons.forEach((button) => this.drawCircleButton(ctx, button, activeButtons[button.key]));
    this.controls.system.forEach((button) => this.drawPillButton(ctx, button, activeButtons[button.key]));
    this.controls.commands.forEach((button) => this.drawCommand(ctx, button));
  }

  drawDpad(ctx, activeButtons) {
    const dpad = this.controls.dpad;
    const s = dpad.size;
    const x = dpad.center.x;
    const y = dpad.center.y;

    ctx.fillStyle = '#2d3436';
    roundedRect(ctx, x - s * 1.35, y - s * 0.42, s * 2.7, s * 0.84, 8);
    ctx.fill();
    roundedRect(ctx, x - s * 0.42, y - s * 1.35, s * 0.84, s * 2.7, 8);
    ctx.fill();

    ctx.fillStyle = '#15191a';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.28, 0, Math.PI * 2);
    ctx.fill();

    this.drawDpadHighlight(ctx, 'left', activeButtons.left, x - s * 0.86, y);
    this.drawDpadHighlight(ctx, 'right', activeButtons.right, x + s * 0.86, y);
    this.drawDpadHighlight(ctx, 'up', activeButtons.up, x, y - s * 0.86);
    this.drawDpadHighlight(ctx, 'down', activeButtons.down, x, y + s * 0.86);
  }

  drawDpadHighlight(ctx, key, active, x, y) {
    if (!active) {
      return;
    }
    ctx.fillStyle = '#6f7772';
    ctx.beginPath();
    ctx.arc(x, y, this.controls.dpad.size * 0.22, 0, Math.PI * 2);
    ctx.fill();
  }

  drawCircleButton(ctx, button, active) {
    ctx.beginPath();
    ctx.arc(button.x, button.y, button.radius, 0, Math.PI * 2);
    ctx.fillStyle = active ? '#8e2f46' : '#b33b59';
    ctx.fill();
    ctx.strokeStyle = '#6e2336';
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.fillStyle = '#f8e7ee';
    ctx.font = 'bold 17px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(button.label, button.x, button.y + 6);
  }

  drawPillButton(ctx, button, active) {
    const rect = button.rect;
    roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, rect.height / 2);
    ctx.fillStyle = active ? '#59605d' : '#707a75';
    ctx.fill();
    ctx.fillStyle = '#f2f5ef';
    ctx.font = 'bold 10px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(button.label, rect.x + rect.width / 2, rect.y + rect.height / 2 + 4);
  }

  drawShoulderButton(ctx, button, active) {
    const rect = button.rect;
    roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 12);
    ctx.fillStyle = active ? '#8e2f46' : '#b33b59';
    ctx.fill();
    ctx.strokeStyle = '#6e2336';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#f8e7ee';
    ctx.font = 'bold 14px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(button.label, rect.x + rect.width / 2, rect.y + rect.height / 2 + 5);
  }

  drawCommand(ctx, button) {
    const rect = button.rect;
    roundedRect(ctx, rect.x, rect.y, rect.width, rect.height, 8);
    ctx.fillStyle = '#f4f7ef';
    ctx.fill();
    ctx.strokeStyle = '#9aa49d';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = '#26312c';
    ctx.font = 'bold 12px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(button.label, rect.x + rect.width / 2, rect.y + rect.height / 2 + 4);
  }
}
