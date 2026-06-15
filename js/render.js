GameGlobal.canvas = wx.createCanvas();

function getWindowSize() {
  const windowInfo = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
  return {
    width: windowInfo.windowWidth || windowInfo.screenWidth,
    height: windowInfo.windowHeight || windowInfo.screenHeight,
  };
}

export function resizeCanvasToWindow() {
  const size = getWindowSize();
  canvas.width = size.width;
  canvas.height = size.height;
  return size;
}

const initialSize = resizeCanvasToWindow();

export const SCREEN_WIDTH = initialSize.width;
export const SCREEN_HEIGHT = initialSize.height;
