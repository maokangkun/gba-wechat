export default class WechatAudioSink {
  constructor() {
    this.context = null;
    this.gainNode = null;
    this.sourceSampleRate = 44100;
    this.outputSampleRate = 44100;
    this.channelCount = 2;
    this.volume = 1;
    this.nextStartTime = 0;
    this.enabled = false;
    this.warned = false;
    this.maxQueueSeconds = 0.06;
    this.startDelaySeconds = 0.004;
    this.minBufferFrames = 1;
    this.pending = [];
    this.pendingFrames = 0;
    this.pushedFrames = 0;
    this.playedBuffers = 0;
    this.lastError = '';
    this.peak = 0;
  }

  initialize(channelCount, sampleRate, bufferAmount, startingVolume, errorCallback) {
    this.closeContext();
    this.channelCount = channelCount || 2;
    this.sourceSampleRate = sampleRate || 44100;
    this.volume = typeof startingVolume === 'number' ? startingVolume : 1;

    const context = this.createContext();
    if (!context) {
      this.enabled = false;
      if (!this.warned) {
        console.warn('[GBA] WebAudio is unavailable in this WeChat runtime');
        this.warned = true;
      }
      if (typeof errorCallback === 'function') {
        errorCallback();
      }
      return;
    }

    this.context = context;
    this.outputSampleRate = context.sampleRate || 44100;
    this.gainNode = this.createGainNode(context);
    this.changeVolume(this.volume);
    this.nextStartTime = context.currentTime || 0;
    this.enabled = true;
    this.pending = [];
    this.pendingFrames = 0;
    this.pushedFrames = 0;
    this.playedBuffers = 0;
    this.lastError = '';
  }

  createContext() {
    if (typeof wx !== 'undefined' && wx.createWebAudioContext) {
      try {
        const context = wx.createWebAudioContext();
        return context;
      } catch (error) {
        console.warn('[GBA] wx.createWebAudioContext failed', error);
        this.lastError = error && error.message ? error.message : 'wx.createWebAudioContext failed';
      }
    }

    const root = typeof GameGlobal !== 'undefined' ? GameGlobal : globalThis;
    const AudioContextCtor = root.AudioContext || root.webkitAudioContext;
    if (AudioContextCtor) {
      try {
        return new AudioContextCtor();
      } catch (error) {
        console.warn('[GBA] AudioContext creation failed', error);
        this.lastError = error && error.message ? error.message : 'AudioContext creation failed';
      }
    }

    return null;
  }

  closeContext() {
    this.enabled = false;
    this.nextStartTime = 0;
    if (this.context && this.context.close) {
      this.context.close();
    } else if (this.context && this.context.suspend) {
      this.context.suspend();
    }
    this.context = null;
    this.gainNode = null;
    this.pending = [];
    this.pendingFrames = 0;
  }

  createGainNode(context) {
    if (!context || !context.destination) {
      return null;
    }

    const gainNode = context.createGain ? context.createGain() : null;
    if (gainNode) {
      gainNode.connect(context.destination);
      return gainNode;
    }
    return null;
  }

  register() {
    if (!this.context) {
      return;
    }
    if (this.context.resume) {
      const result = this.context.resume();
      if (result && result.catch) {
        result.catch((error) => {
          this.lastError = error && error.message ? error.message : 'AudioContext resume failed';
        });
      }
    }
    this.enabled = true;
  }

  unregister() {
    this.enabled = false;
    if (this.context && this.context.suspend) {
      this.context.suspend();
    }
    this.nextStartTime = 0;
    this.pending = [];
    this.pendingFrames = 0;
  }

  changeVolume(volume) {
    this.volume = Math.min(Math.max(Number(volume) || 0, 0), 1);
    if (this.gainNode && this.gainNode.gain) {
      this.gainNode.gain.value = this.volume;
    }
  }

  push(buffer) {
    if (!this.enabled || !this.context || !buffer || !buffer.length) {
      return;
    }

    const frameCount = Math.floor(buffer.length / this.channelCount);
    if (frameCount <= 0) {
      return;
    }

    this.pending.push(new Float32Array(buffer));
    this.pendingFrames += frameCount;
    this.pushedFrames += frameCount;

    if (this.pendingFrames < this.minBufferFrames) {
      return;
    }
    this.flush();
  }

  flush(force) {
    if (!this.enabled || !this.context || this.pendingFrames <= 0) {
      return;
    }
    if (!force && this.pendingFrames < this.minBufferFrames) {
      return;
    }

    const context = this.context;
    if (!context.createBuffer || !context.createBufferSource) {
      this.lastError = 'WebAudio buffer API unavailable';
      return;
    }

    const sourceFrameCount = this.pendingFrames;
    const frameCount = Math.max(1, Math.round(sourceFrameCount * this.outputSampleRate / this.sourceSampleRate));
    const now = context.currentTime || 0;
    if (this.nextStartTime < now + this.startDelaySeconds) {
      this.nextStartTime = now + this.startDelaySeconds;
    }
    if (this.nextStartTime - now > this.maxQueueSeconds) {
      this.nextStartTime = now + this.startDelaySeconds;
    }

    let audioBuffer = null;
    try {
      audioBuffer = context.createBuffer(this.channelCount, frameCount, this.outputSampleRate);
    } catch (error) {
      if (!this.warned) {
        console.warn('[GBA] createBuffer failed', error);
        this.warned = true;
      }
      this.lastError = error && error.message ? error.message : 'createBuffer failed';
      return;
    }

    const channelData = [];
    for (let channel = 0; channel < this.channelCount; channel++) {
      channelData[channel] = audioBuffer.getChannelData(channel);
    }

    const sourceFrames = sourceFrameCount;
    const mixed = new Float32Array(sourceFrames * this.channelCount);
    let writeOffset = 0;
    for (let partIndex = 0; partIndex < this.pending.length; partIndex++) {
      const part = this.pending[partIndex];
      mixed.set(part, writeOffset);
      writeOffset += part.length;
    }

    if (frameCount === sourceFrames) {
      for (let channel = 0; channel < this.channelCount; channel++) {
        const target = channelData[channel];
        for (let i = 0, source = channel; i < frameCount; i++, source += this.channelCount) {
          target[i] = mixed[source];
        }
      }
    } else {
      const scale = sourceFrames / frameCount;
      for (let channel = 0; channel < this.channelCount; channel++) {
        const target = channelData[channel];
        for (let i = 0; i < frameCount; i++) {
          const srcPos = i * scale;
          const srcIndex = Math.floor(srcPos);
          const nextIndex = Math.min(srcIndex + 1, sourceFrames - 1);
          const t = srcPos - srcIndex;
          const a = mixed[srcIndex * this.channelCount + channel] || 0;
          const b = mixed[nextIndex * this.channelCount + channel] || 0;
          target[i] = a + (b - a) * t;
        }
      }
    }
    for (let i = 0; i < mixed.length; i++) {
      const value = Math.abs(mixed[i]);
      if (value > this.peak) {
        this.peak = value;
      }
    }
    this.pending = [];
    this.pendingFrames = 0;

    const sourceNode = context.createBufferSource();
    sourceNode.buffer = audioBuffer;
    sourceNode.connect(this.gainNode || context.destination);
    sourceNode.onended = () => {
      if (sourceNode.disconnect) {
        sourceNode.disconnect();
      }
    };
    try {
      sourceNode.start(this.nextStartTime);
    } catch (error) {
      this.nextStartTime = now + this.startDelaySeconds;
      try {
        sourceNode.start(this.nextStartTime);
      } catch (secondError) {
        this.lastError = secondError && secondError.message ? secondError.message : 'sourceNode.start failed';
        if (sourceNode.disconnect) {
          sourceNode.disconnect();
        }
        return;
      }
    }
    this.nextStartTime += frameCount / this.outputSampleRate;
    this.playedBuffers++;
  }

  remainingBuffer() {
    if (!this.enabled || !this.context) {
      return 0;
    }
    const remainingSeconds = Math.max(this.nextStartTime - (this.context.currentTime || 0), 0);
    return remainingSeconds * this.sourceSampleRate * this.channelCount;
  }

  getDebugState() {
    return {
      enabled: this.enabled,
      hasContext: !!this.context,
      sampleRate: this.sourceSampleRate,
      outputSampleRate: this.outputSampleRate,
      pendingFrames: this.pendingFrames,
      pushedFrames: this.pushedFrames,
      playedBuffers: this.playedBuffers,
      currentTime: this.context && this.context.currentTime || 0,
      queuedSamples: this.remainingBuffer(),
      peak: this.peak,
      lastError: this.lastError,
    };
  }
}
