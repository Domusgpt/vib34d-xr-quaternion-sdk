import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { CanvasManager } from '../src/core/CanvasManager.js';

describe('CanvasManager', () => {
  let manager: any;
  let containers: Map<string, any>;
  let canvasSet: Set<any>;
  let canvasMap: Map<string, any>;
  let addEventListenerSpy: ReturnType<typeof vi.fn>;
  let removeEventListenerSpy: ReturnType<typeof vi.fn>;

  const createCanvasElement = () => {
    const loseContext = vi.fn();
    const gl = {
      getExtension: vi.fn(() => ({ loseContext })),
      isContextLost: vi.fn(() => false)
    };

    const canvas: any = {
      id: '',
      className: '',
      style: {},
      width: 0,
      height: 0,
      parent: null,
      getContext: vi.fn(() => gl),
      remove: vi.fn(() => {
        if (canvas.parent && canvas.parent._children) {
          canvas.parent._children.delete(canvas);
        }
        canvasSet.delete(canvas);
        if (canvas.id) {
          canvasMap.delete(canvas.id);
        }
      })
    };

    return canvas;
  };

  const createContainer = (id: string, width: number, height: number) => {
    const container: any = {
      id,
      style: {},
      clientWidth: width,
      clientHeight: height,
      _children: new Set<any>(),
      appendChild(child: any) {
        child.parent = container;
        container._children.add(child);
        canvasSet.add(child);
        if (child.id) {
          canvasMap.set(child.id, child);
        }
      }
    };

    Object.defineProperty(container, 'innerHTML', {
      get: () => '',
      set: () => {
        container._children.forEach((child: any) => {
          canvasSet.delete(child);
          if (child.id) {
            canvasMap.delete(child.id);
          }
        });
        container._children.clear();
      }
    });

    containers.set(id, container);
    return container;
  };

  beforeEach(() => {
    containers = new Map();
    canvasSet = new Set();
    canvasMap = new Map();

    addEventListenerSpy = vi.fn();
    removeEventListenerSpy = vi.fn();

    const customEventMock = class {
      type: string;
      detail: any;
      constructor(type: string, init?: { detail?: any }) {
        this.type = type;
        this.detail = init?.detail;
      }
    };

    (globalThis as any).window = {
      innerWidth: 1024,
      innerHeight: 640,
      devicePixelRatio: 1.5,
      addEventListener: addEventListenerSpy,
      removeEventListener: removeEventListenerSpy,
      dispatchEvent: vi.fn(),
      CustomEvent: customEventMock
    };

    (globalThis as any).document = {
      querySelectorAll: (selector: string) => selector === 'canvas' ? Array.from(canvasSet) : [],
      getElementById: (id: string) => containers.get(id) || canvasMap.get(id) || null,
      createElement: (tag: string) => {
        if (tag !== 'canvas') {
          throw new Error(`Unsupported tag: ${tag}`);
        }
        return createCanvasElement();
      },
      createEvent: vi.fn(() => ({
        initCustomEvent: vi.fn()
      }))
    };

    createContainer('vib34dLayers', 640, 360);
    createContainer('quantumLayers', 0, 0);
    createContainer('holographicLayers', 640, 360);
    createContainer('polychoraLayers', 640, 360);

    manager = new CanvasManager();
  });

  afterEach(() => {
    manager?.destroy();
    delete (globalThis as any).window;
    delete (globalThis as any).document;
  });

  it('resizes active canvases and notifies the engine when the viewport changes', () => {
    manager.destroyAllCanvasesAndCreateFresh('faceted');
    manager.currentSystem = 'faceted';

    const resizeSpy = vi.fn();
    manager.currentEngine = { resize: resizeSpy } as any;

    const container = containers.get('vib34dLayers');
    container.clientWidth = 800;
    container.clientHeight = 450;
    (globalThis as any).window.devicePixelRatio = 2;

    manager.handleResize();

    const ids = manager.getCanvasIdsForSystem('faceted');
    ids.forEach(id => {
      const canvas = canvasMap.get(id);
      expect(canvas.width).toBe(1600);
      expect(canvas.height).toBe(900);
      expect(canvas.style.width).toBe('800px');
      expect(canvas.style.height).toBe('450px');
    });

    expect(resizeSpy).toHaveBeenCalledTimes(1);
    expect(resizeSpy).toHaveBeenCalledWith({ width: 800, height: 450, dpr: 2 });
  });

  it('falls back to viewport dimensions when the active container has no size', () => {
    manager.destroyAllCanvasesAndCreateFresh('quantum');
    manager.currentSystem = 'quantum';

    (globalThis as any).window.innerWidth = 900;
    (globalThis as any).window.innerHeight = 600;
    (globalThis as any).window.devicePixelRatio = 1.25;

    manager.handleResize();

    const ids = manager.getCanvasIdsForSystem('quantum');
    ids.forEach(id => {
      const canvas = canvasMap.get(id);
      expect(canvas.width).toBe(1125);
      expect(canvas.height).toBe(750);
      expect(canvas.style.width).toBe('900px');
      expect(canvas.style.height).toBe('600px');
    });
  });

  it('registers resize listeners during construction', () => {
    expect(addEventListenerSpy).toHaveBeenCalledWith('resize', expect.any(Function), { passive: true });
  });

  it('removes resize listeners when destroyed', () => {
    const resizeCall = addEventListenerSpy.mock.calls.find(call => call[0] === 'resize');
    const orientationCall = addEventListenerSpy.mock.calls.find(call => call[0] === 'orientationchange');

    manager.destroy();
    manager = null;

    if (resizeCall) {
      expect(removeEventListenerSpy).toHaveBeenCalledWith('resize', resizeCall[1], { passive: true });
    }

    if (orientationCall) {
      expect(removeEventListenerSpy).toHaveBeenCalledWith('orientationchange', orientationCall[1], { passive: true });
    }
  });
});
