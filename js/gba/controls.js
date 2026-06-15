const COMMANDS = ['online', 'local', 'layout', 'save', 'load', 'perf', 'play', 'reset'];

function pointInRect(point, rect) {
  return point.x >= rect.x &&
    point.x <= rect.x + rect.width &&
    point.y >= rect.y &&
    point.y <= rect.y + rect.height;
}

function pointInCircle(point, circle) {
  const dx = point.x - circle.x;
  const dy = point.y - circle.y;
  return dx * dx + dy * dy <= circle.radius * circle.radius;
}

export default class GBAControls {
  constructor(layout, handlers) {
    this.layout = layout;
    this.handlers = handlers;
    this.activeTouches = {};
    this.activeButtons = {};
  }

  handleTouchStart(event) {
    (event.changedTouches || []).forEach((touch) => this.updateTouch(touch, true, true));
  }

  handleTouchMove(event) {
    (event.changedTouches || []).forEach((touch) => this.updateTouch(touch, true, false));
  }

  handleTouchEnd(event) {
    (event.changedTouches || []).forEach((touch) => this.releaseTouch(touch.identifier));
  }

  handleTouchCancel(event) {
    (event.changedTouches || []).forEach((touch) => this.releaseTouch(touch.identifier));
  }

  updateTouch(touch, isDown, allowCommand) {
    const id = touch.identifier;
    const point = { x: touch.clientX, y: touch.clientY };
    const hit = this.hitTest(point);

    if (!isDown || !hit) {
      this.releaseTouch(id);
      return;
    }

    if (COMMANDS.indexOf(hit) !== -1) {
      if (!allowCommand) {
        return;
      }
      this.handlers.onCommand(hit);
      return;
    }

    const previous = this.activeTouches[id];
    if (previous === hit) {
      return;
    }
    if (previous) {
      this.releaseButton(previous);
    }

    this.activeTouches[id] = hit;
    this.pressButton(hit);
  }

  releaseTouch(id) {
    const button = this.activeTouches[id];
    if (button) {
      this.releaseButton(button);
      delete this.activeTouches[id];
    }
  }

  pressButton(button) {
    this.activeButtons[button] = (this.activeButtons[button] || 0) + 1;
    if (this.activeButtons[button] === 1) {
      this.handlers.onButtonDown(button);
      this.notifyChange();
    }
  }

  releaseButton(button) {
    if (!this.activeButtons[button]) {
      return;
    }
    this.activeButtons[button] -= 1;
    if (this.activeButtons[button] === 0) {
      delete this.activeButtons[button];
      this.handlers.onButtonUp(button);
      this.notifyChange();
    }
  }

  notifyChange() {
    if (this.handlers.onChange) {
      this.handlers.onChange();
    }
  }

  hitTest(point) {
    const zones = this.layout.controls;

    for (let index = 0; index < zones.commands.length; index++) {
      const item = zones.commands[index];
      if (pointInRect(point, item.rect)) {
        return item.command;
      }
    }

    const dpad = zones.dpad;
    if (pointInCircle(point, dpad.bounds)) {
      const dx = point.x - dpad.center.x;
      const dy = point.y - dpad.center.y;
      if (Math.abs(dx) > Math.abs(dy)) {
        return dx > 0 ? 'right' : 'left';
      }
      return dy > 0 ? 'down' : 'up';
    }

    for (let index = 0; index < zones.buttons.length; index++) {
      const item = zones.buttons[index];
      if (pointInCircle(point, item)) {
        return item.key;
      }
    }

    for (let index = 0; index < zones.shoulders.length; index++) {
      const item = zones.shoulders[index];
      if (pointInRect(point, item.rect)) {
        return item.key;
      }
    }

    for (let index = 0; index < zones.system.length; index++) {
      const item = zones.system[index];
      if (pointInRect(point, item.rect)) {
        return item.key;
      }
    }

    return null;
  }

  render(ctx) {
    this.layout.drawControls(ctx, this.activeButtons);
  }
}
