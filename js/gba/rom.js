import { ROM_SOURCE } from './rom-config';
import BUNDLED_BIOS_BASE64 from './bundled-bios';

const GBA_BIOS_SIZE = 0x4000;

function isDevtoolsSimulator() {
  try {
    const info = wx.getWindowInfo ? wx.getWindowInfo() : wx.getSystemInfoSync();
    return info && info.platform === 'devtools';
  } catch (error) {
    return false;
  }
}

function chooseRomFile() {
  if (!wx.chooseMessageFile) {
    return Promise.reject(new Error('当前微信版本不支持文件选择'));
  }

  return new Promise((resolve, reject) => {
    wx.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['gba', 'bin', 'rom'],
      success: (result) => {
        const file = result.tempFiles && result.tempFiles[0];
        if (!file || !file.path) {
          reject(new Error('未选择 ROM 文件'));
          return;
        }
        resolve(file);
      },
      fail: () => reject(new Error('已取消导入')),
    });
  });
}

function hasRemoteRomConfig() {
  return !!(ROM_SOURCE.cloudFileID || ROM_SOURCE.httpsUrl);
}

function readFileAsArrayBuffer(path) {
  const fs = wx.getFileSystemManager && wx.getFileSystemManager();
  if (!fs) {
    return Promise.reject(new Error('文件系统不可用'));
  }

  return new Promise((resolve, reject) => {
    fs.readFile({
      filePath: path,
      success: (result) => resolve(result.data),
      fail: (error) => reject(new Error(`读取 ROM 失败: ${path} ${error.errMsg || ''}`)),
    });
  });
}

function ensureCloud(source) {
  if (wx.cloud && wx.cloud.init) {
    wx.cloud.init({
      env: source.cloudEnv || undefined,
      traceUser: true,
    });
  }
}

function getCloudTempFileURL(source, fileID, label) {
  if (!fileID || !wx.cloud || !wx.cloud.getTempFileURL) {
    return Promise.reject(new Error('未配置云存储 fileID'));
  }

  ensureCloud(source);

  return new Promise((resolve, reject) => {
    wx.cloud.getTempFileURL({
      fileList: [fileID],
      success: (result) => {
        const file = result.fileList && result.fileList[0];
        if (file && file.status === 0 && file.tempFileURL) {
          resolve(file.tempFileURL);
          return;
        }
        reject(new Error(`云端 ${label} 取临时链接失败: status=${file && file.status}, err=${file && file.errMsg || 'empty tempFileURL'}`));
      },
      fail: (error) => reject(new Error(`云端 ${label} 取临时链接失败: ${error.errMsg || ''}`)),
    });
  });
}

function normalizeProgress(progress) {
  const value = Number(progress);
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(100, Math.floor(value)));
}

function notifyDownloadProgress(onProgress, progress) {
  if (typeof onProgress === 'function') {
    onProgress(normalizeProgress(progress));
  }
}

function downloadCloudFileDirect(source, fileID, label, onProgress) {
  if (!fileID || !wx.cloud || !wx.cloud.downloadFile) {
    return Promise.reject(new Error('未配置云存储 fileID'));
  }

  ensureCloud(source);

  return new Promise((resolve, reject) => {
    const task = wx.cloud.downloadFile({
      fileID,
      success: (result) => {
        if (result.tempFilePath) {
          notifyDownloadProgress(onProgress, 100);
          resolve(result.tempFilePath);
          return;
        }
        reject(new Error(`云端 ${label} 下载失败: empty tempFilePath`));
      },
      fail: (error) => reject(new Error(`云端 ${label} 下载失败: ${error.errMsg || ''}`)),
    });
    if (task && task.onProgressUpdate) {
      task.onProgressUpdate((result) => notifyDownloadProgress(onProgress, result.progress));
    }
  });
}

function downloadURLFile(url, label, onProgress) {
  if (!url || !wx.downloadFile) {
    return Promise.reject(new Error(`未配置 HTTPS ${label} 地址`));
  }

  return new Promise((resolve, reject) => {
    const task = wx.downloadFile({
      url,
      success: (result) => {
        if (result.statusCode >= 200 && result.statusCode < 300 && result.tempFilePath) {
          notifyDownloadProgress(onProgress, 100);
          resolve(result.tempFilePath);
          return;
        }
        reject(new Error(`${label} 下载失败: HTTP ${result.statusCode}`));
      },
      fail: (error) => reject(new Error(`${label} 下载失败: ${error.errMsg || ''}`)),
    });
    if (task && task.onProgressUpdate) {
      task.onProgressUpdate((result) => notifyDownloadProgress(onProgress, result.progress));
    }
  });
}

async function downloadCloudFile(source, fileID, label, onProgress) {
  try {
    return await downloadCloudFileDirect(source, fileID, label, onProgress);
  } catch (directError) {
    console.warn(`[GBA] cloud ${label} direct download failed, trying temp URL`, directError);
  }

  const url = await getCloudTempFileURL(source, fileID, label);
  return downloadURLFile(url, label, onProgress);
}

function downloadConfiguredHttpsFile(url, label, onProgress) {
  return downloadURLFile(url, label, onProgress);
}

function ensureValidBios(data) {
  const size = data && (data.byteLength || data.length) || 0;
  if (size !== GBA_BIOS_SIZE) {
    throw new Error(`BIOS 必须是 16KB，当前大小 ${size} 字节`);
  }
  return data;
}

function decodeBase64ToArrayBuffer(base64) {
  if (!base64) {
    return null;
  }
  if (typeof wx !== 'undefined' && wx.base64ToArrayBuffer) {
    return wx.base64ToArrayBuffer(base64);
  }

  const root = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
  if (root.atob) {
    const binary = root.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i) & 0xFF;
    }
    return bytes.buffer;
  }

  throw new Error('当前环境不支持 BIOS base64 解码');
}

function readDevtoolsRomModule() {
  try {
    const devRom = require('./dev-rom');
    if (!devRom || !devRom.base64) {
      return null;
    }
    const data = decodeBase64ToArrayBuffer(devRom.base64);
    console.log('[GBA] loaded DevTools bundled ROM', devRom.name, data.byteLength || data.length || 0);
    return { name: devRom.name || 'devtools.gba', data, source: 'devtools' };
  } catch (error) {
    if (isDevtoolsSimulator()) {
      console.warn('[GBA] DevTools bundled ROM unavailable, using online ROM', error);
    }
    return null;
  }
}

async function readBundledBios() {
  if (ROM_SOURCE.bundledBiosPath) {
    try {
      const data = await readFileAsArrayBuffer(ROM_SOURCE.bundledBiosPath);
      console.log('[GBA] loaded bundled BIOS file', data.byteLength || data.length || 0);
      return ensureValidBios(data);
    } catch (error) {
      console.warn('[GBA] bundled BIOS file failed, trying embedded BIOS', error);
    }
  }

  if (BUNDLED_BIOS_BASE64) {
    const data = decodeBase64ToArrayBuffer(BUNDLED_BIOS_BASE64);
    console.log('[GBA] loaded embedded BIOS', data.byteLength || data.length || 0);
    return ensureValidBios(data);
  }

  return null;
}

async function readOptionalBios() {
  const bundledBios = await readBundledBios();
  if (bundledBios) {
    return bundledBios;
  }

  if (!ROM_SOURCE.biosCloudFileID && !ROM_SOURCE.biosHttpsUrl) {
    return null;
  }

  let lastError = null;

  try {
    const path = await downloadCloudFile(ROM_SOURCE, ROM_SOURCE.biosCloudFileID, 'BIOS');
    const data = await readFileAsArrayBuffer(path);
    console.log('[GBA] loaded cloud BIOS', data.byteLength || data.length || 0);
    return ensureValidBios(data);
  } catch (error) {
    lastError = error;
  }

  try {
    const path = await downloadConfiguredHttpsFile(ROM_SOURCE.biosHttpsUrl, 'BIOS');
    const data = await readFileAsArrayBuffer(path);
    console.log('[GBA] loaded HTTPS BIOS', data.byteLength || data.length || 0);
    return ensureValidBios(data);
  } catch (error) {
    lastError = error;
  }

  if (ROM_SOURCE.biosCloudFileID || ROM_SOURCE.biosHttpsUrl) {
    console.warn('[GBA] BIOS configured but failed to load', lastError);
    throw new Error(lastError && lastError.message ? lastError.message : 'BIOS 加载失败');
  }
  return null;
}

async function readRemoteRom(options = {}) {
  const errors = [];
  const onProgress = options.onProgress;

  if (ROM_SOURCE.cloudFileID && !ROM_SOURCE.preferHttps) {
    try {
      const path = await downloadCloudFile(ROM_SOURCE, ROM_SOURCE.cloudFileID, 'ROM', onProgress);
      const data = await readFileAsArrayBuffer(path);
      const bios = await readOptionalBios();
      console.log(`[GBA] loaded cloud ROM: ${ROM_SOURCE.name}`, data.byteLength || data.length || 0);
      return { name: ROM_SOURCE.name || 'cloud.gba', data, bios, source: 'cloud' };
    } catch (error) {
      errors.push(error.message || String(error));
      console.warn('[GBA] cloud ROM download failed, trying HTTPS URL', error);
    }
  }

  try {
    const path = await downloadConfiguredHttpsFile(ROM_SOURCE.httpsUrl, 'ROM', onProgress);
    const data = await readFileAsArrayBuffer(path);
    const bios = await readOptionalBios();
    console.log(`[GBA] loaded HTTPS ROM: ${ROM_SOURCE.name}`, data.byteLength || data.length || 0);
    return { name: ROM_SOURCE.name || 'remote.gba', data, bios, source: 'https' };
  } catch (error) {
    errors.push(error.message || String(error));
  }

  throw new Error(errors.length ? errors.join('；') : '未配置云端 ROM');
}

export async function readOnlineRom(options = {}) {
  const devRom = readDevtoolsRomModule();
  if (devRom) {
    notifyDownloadProgress(options.onProgress, 100);
    const bios = await readOptionalBios();
    return { ...devRom, bios };
  }

  try {
    return await readRemoteRom(options);
  } catch (error) {
    console.warn('[GBA] remote ROM import failed', error);
    throw error;
  }
}

export async function readLocalRom() {
  const file = await chooseRomFile();
  const data = await readFileAsArrayBuffer(file.path);
  const bios = await readOptionalBios();
  const name = file.name || file.path.split('/').pop() || 'game.gba';
  console.log(`[GBA] loaded selected ROM: ${name}`, data.byteLength || data.length || 0);
  return { name, data, bios, source: 'selected' };
}

export async function readRomFromUserFile() {
  if (hasRemoteRomConfig()) {
    return readOnlineRom();
  }
  return readLocalRom();
}
