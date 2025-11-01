/**
 * Vitest Global Setup
 * Configures the test environment for VIB34D XR Quaternion SDK
 */

// Mock WebGL context for headless testing
global.WebGLRenderingContext = class WebGLRenderingContext {};
global.WebGL2RenderingContext = class WebGL2RenderingContext {};

// Mock HTMLCanvasElement.getContext
HTMLCanvasElement.prototype.getContext = function(contextType) {
  if (contextType === 'webgl' || contextType === 'webgl2') {
    return {
      canvas: this,
      drawingBufferWidth: 800,
      drawingBufferHeight: 600,
      getParameter: () => 16,
      createShader: () => ({}),
      shaderSource: () => {},
      compileShader: () => {},
      getShaderParameter: () => true,
      createProgram: () => ({}),
      attachShader: () => {},
      linkProgram: () => {},
      getProgramParameter: () => true,
      useProgram: () => {},
      getAttribLocation: () => 0,
      getUniformLocation: () => ({}),
      enableVertexAttribArray: () => {},
      vertexAttribPointer: () => {},
      uniform1f: () => {},
      uniform2f: () => {},
      uniform3f: () => {},
      uniform4f: () => {},
      uniformMatrix4fv: () => {},
      createBuffer: () => ({}),
      bindBuffer: () => {},
      bufferData: () => {},
      clear: () => {},
      clearColor: () => {},
      enable: () => {},
      disable: () => {},
      viewport: () => {},
      drawArrays: () => {},
      drawElements: () => {},
      deleteShader: () => {},
      deleteProgram: () => {},
      deleteBuffer: () => {},
    };
  }
  return null;
};

// Mock AudioContext for audio-reactive tests
global.AudioContext = class AudioContext {
  constructor() {
    this.sampleRate = 44100;
    this.destination = {};
  }

  createAnalyser() {
    return {
      fftSize: 2048,
      frequencyBinCount: 1024,
      getByteFrequencyData: (array) => {
        // Fill with mock frequency data
        for (let i = 0; i < array.length; i++) {
          array[i] = Math.floor(Math.random() * 255);
        }
      },
      connect: () => {},
      disconnect: () => {},
    };
  }

  createMediaStreamSource() {
    return {
      connect: () => {},
      disconnect: () => {},
    };
  }
};

// Mock localStorage
global.localStorage = {
  store: {},
  getItem(key) {
    return this.store[key] || null;
  },
  setItem(key, value) {
    this.store[key] = String(value);
  },
  removeItem(key) {
    delete this.store[key];
  },
  clear() {
    this.store = {};
  },
};

// Mock console methods to reduce noise in tests
global.console = {
  ...console,
  log: () => {},
  debug: () => {},
  info: () => {},
  warn: console.warn,
  error: console.error,
};
