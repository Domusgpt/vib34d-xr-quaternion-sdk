import { describe, expect, it } from 'vitest';
import WebGLFallbackPreview from '../src/dev/webglFallbackPreview.ts';

type UniformLocation = { program: unknown; name: string };

type Shader = { type: number };

type Program = { shaders: Shader[] };

type Buffer = { id: number };

class MockWebGLContext {
  public readonly VERTEX_SHADER = 0x8b31;
  public readonly FRAGMENT_SHADER = 0x8b30;
  public readonly COMPILE_STATUS = 0x8b81;
  public readonly LINK_STATUS = 0x8b82;
  public readonly ARRAY_BUFFER = 0x8892;
  public readonly STATIC_DRAW = 0x88e4;
  public readonly FLOAT = 0x1406;
  public readonly TRIANGLE_STRIP = 0x0005;
  public readonly COLOR_BUFFER_BIT = 0x4000;
  public readonly DEPTH_TEST = 0x0b71;
  public readonly CULL_FACE = 0x0b44;

  private nextBufferId = 0;

  createShader(type: number): Shader {
    return { type };
  }

  shaderSource(_shader: Shader, _source: string): void {}

  compileShader(_shader: Shader): void {}

  getShaderParameter(_shader: Shader, pname: number): boolean {
    return pname === this.COMPILE_STATUS;
  }

  getShaderInfoLog(): string {
    return '';
  }

  deleteShader(_shader: Shader): void {}

  createProgram(): Program {
    return { shaders: [] };
  }

  attachShader(program: Program, shader: Shader): void {
    program.shaders.push(shader);
  }

  linkProgram(_program: Program): void {}

  getProgramParameter(_program: Program, pname: number): boolean {
    return pname === this.LINK_STATUS;
  }

  getProgramInfoLog(): string {
    return '';
  }

  useProgram(_program: Program): void {}

  deleteProgram(_program: Program): void {}

  getUniformLocation(program: Program, name: string): UniformLocation {
    return { program, name };
  }

  getAttribLocation(_program: Program, _name: string): number {
    return 0;
  }

  createBuffer(): Buffer {
    return { id: this.nextBufferId++ };
  }

  bindBuffer(_target: number, _buffer: Buffer | null): void {}

  bufferData(_target: number, _data: ArrayBufferView, _usage: number): void {}

  enableVertexAttribArray(_index: number): void {}

  vertexAttribPointer(
    _index: number,
    _size: number,
    _type: number,
    _normalized: boolean,
    _stride: number,
    _offset: number,
  ): void {}

  disable(_cap: number): void {}

  clearColor(_r: number, _g: number, _b: number, _a: number): void {}

  viewport(_x: number, _y: number, _width: number, _height: number): void {}

  clear(_mask: number): void {}

  uniform1f(_location: UniformLocation | null, _x: number): void {}

  uniform2f(_location: UniformLocation | null, _x: number, _y: number): void {}

  uniform3f(_location: UniformLocation | null, _x: number, _y: number, _z: number): void {}

  drawArrays(_mode: number, _first: number, _count: number): void {}

  deleteBuffer(_buffer: Buffer): void {}
}

class MockCanvas {
  public width = 640;
  public height = 360;
  public readonly clientWidth = 640;
  public readonly clientHeight = 360;
  private readonly context = new MockWebGLContext();

  getContext(_type: string): MockWebGLContext {
    return this.context;
  }
}

describe('WebGLFallbackPreview', () => {
  it('reports geometry/projection in risk and story metadata', () => {
    const canvas = new MockCanvas() as unknown as HTMLCanvasElement;
    const preview = new WebGLFallbackPreview({
      canvas,
      geometry: 'hypertetrahedron',
      projection: 'stereographic',
    });

    const risks = preview.listRisks();
    expect(risks[0]).toContain('hypertetrahedron');
    expect(risks[0]).toContain('stereographic');

    const stories = preview.listStoryActivations();
    expect(stories[0]?.details).toMatchObject({
      geometry: 'hypertetrahedron',
      projection: 'stereographic',
    });

    preview.dispose();
  });
});
