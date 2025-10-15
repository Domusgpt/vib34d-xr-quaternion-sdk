import { ShaderQuaternionSynchronizer } from '../ui/adaptive/renderers/ShaderQuaternionSynchronizer.js';
import { SensoryInputBridge } from '../ui/adaptive/SensoryInputBridge.js';
import type { StoryTriggerActivation } from '../ui/adaptive/localization/SpatialStoryGraph.ts';
import WebGPUPreviewHarness, { type LayerMaterialUpdate } from './webgpuPreviewHarness.ts';
import WebGLFallbackPreview, { type MaterialOverrides } from './webglFallbackPreview.ts';
import {
  PREVIEW_PRESETS,
  type PreviewPreset,
} from './previewPresets.ts';
import type {
  GlassGeometryModule,
  GlassProjectionModule,
} from '../ui/adaptive/renderers/webgpu/GlassShaderLibrary.ts';
import type {
  LayerDescriptor,
  LayerMaterialConfig,
} from '../ui/adaptive/renderers/webgpu/MultiLayerGlassComposer.ts';

export interface QuaternionPreviewOptions {
  heading?: string;
  initialAngles?: { yaw: number; pitch: number; roll: number };
  initialConfidence?: number;
}

interface ControlHandle {
  input: HTMLInputElement;
  valueLabel: HTMLElement;
}

interface SelectHandle<TValue extends string> {
  select: HTMLSelectElement;
  getValue(): TValue;
}

class MockQuaternionSystem {
  public readonly parameters = new Map<string, number>();
  private readonly root: HTMLElement;
  private readonly list: HTMLElement;
  private readonly values = new Map<string, HTMLElement>();

  constructor(
    private readonly name: string,
    private readonly parent: HTMLElement,
    defaults: Record<string, number>
  ) {
    this.root = document.createElement('section');
    this.root.className = 'qp-system';

    const title = document.createElement('h3');
    title.textContent = name;
    this.root.appendChild(title);

    this.list = document.createElement('dl');
    this.list.className = 'qp-parameter-list';
    this.root.appendChild(this.list);

    parent.appendChild(this.root);

    for (const [key, value] of Object.entries(defaults)) {
      this.parameters.set(key, value);
      this.ensureRow(key).textContent = formatNumber(value);
    }
  }

  updateParameter(key: string, value: number) {
    this.parameters.set(key, value);
    this.ensureRow(key).textContent = formatNumber(value);
  }

  getParameter(key: string) {
    return this.parameters.get(key) ?? 0;
  }

  private ensureRow(key: string) {
    let valueElement = this.values.get(key);
    if (valueElement) {
      return valueElement;
    }

    const term = document.createElement('dt');
    term.textContent = key;
    this.list.appendChild(term);

    valueElement = document.createElement('dd');
    valueElement.textContent = '0';
    this.list.appendChild(valueElement);

    this.values.set(key, valueElement);
    return valueElement;
  }

  destroy() {
    this.parent.removeChild(this.root);
    this.values.clear();
    this.parameters.clear();
  }
}

const formatNumber = (value: number) => value.toFixed(3);

const clamp01 = (value: number) => Math.max(0, Math.min(1, value));

const degToRad = (value: number) => (value * Math.PI) / 180;

const eulerToQuaternion = (yawDeg: number, pitchDeg: number, rollDeg: number) => {
  const yaw = degToRad(yawDeg);
  const pitch = degToRad(pitchDeg);
  const roll = degToRad(rollDeg);

  const cy = Math.cos(yaw * 0.5);
  const sy = Math.sin(yaw * 0.5);
  const cp = Math.cos(pitch * 0.5);
  const sp = Math.sin(pitch * 0.5);
  const cr = Math.cos(roll * 0.5);
  const sr = Math.sin(roll * 0.5);

  return {
    w: cr * cp * cy + sr * sp * sy,
    x: sr * cp * cy - cr * sp * sy,
    y: cr * sp * cy + sr * cp * sy,
    z: cr * cp * sy - sr * sp * cy
  };
};

const clampRange = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));

const floatToHex = (value: number) => {
  const clamped = clamp01(value);
  return Math.round(clamped * 255)
    .toString(16)
    .padStart(2, '0')
    .toUpperCase();
};

const colorToHex = (color: readonly [number, number, number]) =>
  `#${floatToHex(color[0])}${floatToHex(color[1])}${floatToHex(color[2])}`;

const hexToColor = (hex: string): readonly [number, number, number] => {
  const sanitized = hex.trim().replace(/^#/, '');
  if (sanitized.length !== 6 || Number.isNaN(Number(`0x${sanitized}`))) {
    return [0, 0, 0] as const;
  }
  const r = parseInt(sanitized.slice(0, 2), 16) / 255;
  const g = parseInt(sanitized.slice(2, 4), 16) / 255;
  const b = parseInt(sanitized.slice(4, 6), 16) / 255;
  return [clamp01(r), clamp01(g), clamp01(b)] as const;
};

const toRounded = (value: number, precision = 4) => Number(value.toFixed(precision));

interface LayerBlueprint {
  readonly name: string;
  readonly pipelineLabel: string;
  readonly blurRadius?: number;
  readonly geometry: GlassGeometryModule;
  readonly projection: GlassProjectionModule;
}

interface LayerMaterialControl {
  primaryColor: string;
  secondaryColor: string;
  backgroundColor: string;
  patternIntensity: number;
  glitchIntensity: number;
  colorShift: number;
  gridDensity: number;
  lineThickness: number;
  shellWidth: number;
  tetraThickness: number;
}

interface LayerMaterialHandles {
  primary: ControlHandle;
  secondary: ControlHandle;
  background: ControlHandle;
  pattern: ControlHandle;
  glitch: ControlHandle;
  colorShift: ControlHandle;
  grid: ControlHandle;
  line: ControlHandle;
  shell: ControlHandle;
  tetra: ControlHandle;
}

interface LayerState {
  geometry: GlassGeometryModule;
  projection: GlassProjectionModule;
  material: LayerMaterialControl;
}

const LAYER_BLUEPRINTS: LayerBlueprint[] = [
  {
    name: 'Frosted Shell',
    pipelineLabel: 'LayerFrost',
    blurRadius: 7,
    geometry: 'hypersphere',
    projection: 'perspective',
  },
  {
    name: 'Refraction',
    pipelineLabel: 'LayerRefraction',
    blurRadius: 5,
    geometry: 'hypercube',
    projection: 'orthographic',
  },
  {
    name: 'Glyph Veil',
    pipelineLabel: 'LayerGlyph',
    geometry: 'hypertetrahedron',
    projection: 'stereographic',
  },
  {
    name: 'Particle Haze',
    pipelineLabel: 'LayerHaze',
    blurRadius: 3,
    geometry: 'hypercube',
    projection: 'perspective',
  },
  {
    name: 'Highlights',
    pipelineLabel: 'LayerHighlights',
    geometry: 'hypersphere',
    projection: 'orthographic',
  },
];

const createDefaultLayerMaterialControl = (index: number, total: number): LayerMaterialControl => {
  const colorSeed = (index + 1) / (total + 1);
  const primary: [number, number, number] = [
    clamp01(0.45 + colorSeed * 0.35),
    clamp01(0.25 + Math.sin(colorSeed * Math.PI * 1.3) * 0.3),
    clamp01(0.55 + Math.cos(colorSeed * Math.PI * 0.7) * 0.25),
  ];
  const secondary: [number, number, number] = [
    clamp01(0.25 + Math.sin(colorSeed * Math.PI) * 0.4),
    clamp01(0.45 + Math.cos(colorSeed * Math.PI * 0.8) * 0.3),
    clamp01(0.55 + colorSeed * 0.25),
  ];
  const background: [number, number, number] = [
    clamp01(0.05 + 0.15 * colorSeed),
    clamp01(0.04 + 0.1 * (1 - colorSeed)),
    clamp01(0.08 + 0.12 * Math.sin(colorSeed * Math.PI * 0.5)),
  ];

  return {
    primaryColor: colorToHex(primary),
    secondaryColor: colorToHex(secondary),
    backgroundColor: colorToHex(background),
    patternIntensity: toRounded(Math.max(0, 0.85 - colorSeed * 0.35)),
    glitchIntensity: toRounded(Math.max(0, 0.05 + (1 - colorSeed) * 0.08)),
    colorShift: toRounded((colorSeed - 0.5) * 0.4),
    gridDensity: toRounded(8.0 + colorSeed * 4.0),
    lineThickness: toRounded(0.02 + colorSeed * 0.01, 5),
    shellWidth: toRounded(0.02 + (1 - colorSeed) * 0.015, 5),
    tetraThickness: toRounded(0.03 + colorSeed * 0.01, 5),
  };
};

const cloneMaterialControl = (material: LayerMaterialControl): LayerMaterialControl => ({
  primaryColor: material.primaryColor,
  secondaryColor: material.secondaryColor,
  backgroundColor: material.backgroundColor,
  patternIntensity: material.patternIntensity,
  glitchIntensity: material.glitchIntensity,
  colorShift: material.colorShift,
  gridDensity: material.gridDensity,
  lineThickness: material.lineThickness,
  shellWidth: material.shellWidth,
  tetraThickness: material.tetraThickness,
});

const toMaterialConfig = (control: LayerMaterialControl): LayerMaterialConfig => ({
  primaryColor: hexToColor(control.primaryColor),
  secondaryColor: hexToColor(control.secondaryColor),
  backgroundColor: hexToColor(control.backgroundColor),
  patternIntensity: control.patternIntensity,
  glitchIntensity: control.glitchIntensity,
  colorShift: control.colorShift,
  lattice: [
    control.gridDensity,
    control.lineThickness,
    control.shellWidth,
    control.tetraThickness,
  ] as const,
});

const toMaterialUpdate = (control: LayerMaterialControl): LayerMaterialUpdate => ({
  primaryColor: hexToColor(control.primaryColor),
  secondaryColor: hexToColor(control.secondaryColor),
  backgroundColor: hexToColor(control.backgroundColor),
  patternIntensity: control.patternIntensity,
  glitchIntensity: control.glitchIntensity,
  colorShift: control.colorShift,
  lattice: [
    control.gridDensity,
    control.lineThickness,
    control.shellWidth,
    control.tetraThickness,
  ] as const,
});

const toFallbackOverrides = (control: LayerMaterialControl): MaterialOverrides => ({
  primaryColor: hexToColor(control.primaryColor),
  secondaryColor: hexToColor(control.secondaryColor),
  backgroundColor: hexToColor(control.backgroundColor),
  patternIntensity: control.patternIntensity,
  glitchIntensity: control.glitchIntensity,
  colorShift: control.colorShift,
  gridDensity: control.gridDensity,
  lineThickness: control.lineThickness,
  shellWidth: control.shellWidth,
  tetraThickness: control.tetraThickness,
});

const createSlider = (
  container: HTMLElement,
  label: string,
  options: { min: number; max: number; step: number; value: number }
): ControlHandle => {
  const wrapper = document.createElement('label');
  wrapper.className = 'qp-control';
  const text = document.createElement('span');
  text.textContent = label;
  wrapper.appendChild(text);

  const valueLabel = document.createElement('span');
  valueLabel.className = 'qp-control-value';
  wrapper.appendChild(valueLabel);

  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step);
  input.value = String(options.value);
  wrapper.appendChild(input);

  container.appendChild(wrapper);

  valueLabel.textContent = formatNumber(Number(input.value));

  input.addEventListener('input', () => {
    valueLabel.textContent = formatNumber(Number(input.value));
  });

  return { input, valueLabel };
};

const createSelect = <TValue extends string>(
  container: HTMLElement,
  label: string,
  options: readonly { value: TValue; label: string }[],
  initial: TValue
): SelectHandle<TValue> => {
  const wrapper = document.createElement('label');
  wrapper.className = 'qp-control qp-select';

  const text = document.createElement('span');
  text.textContent = label;
  wrapper.appendChild(text);

  const select = document.createElement('select');
  options.forEach(option => {
    const element = document.createElement('option');
    element.value = option.value;
    element.textContent = option.label;
    select.appendChild(element);
  });
  select.value = initial;
  wrapper.appendChild(select);

  container.appendChild(wrapper);

  return {
    select,
    getValue: () => select.value as TValue,
  };
};

const createColorControl = (
  container: HTMLElement,
  label: string,
  value: string,
  onChange: (next: string) => void,
): ControlHandle => {
  const wrapper = document.createElement('label');
  wrapper.className = 'qp-control qp-color';

  const text = document.createElement('span');
  text.textContent = label;
  wrapper.appendChild(text);

  const input = document.createElement('input');
  input.type = 'color';
  input.value = value;
  wrapper.appendChild(input);

  const valueLabel = document.createElement('span');
  valueLabel.className = 'qp-control-value';
  valueLabel.textContent = value.toUpperCase();
  wrapper.appendChild(valueLabel);

  container.appendChild(wrapper);

  const update = (next: string) => {
    const normalized = next.startsWith('#') ? next.toUpperCase() : `#${next.toUpperCase()}`;
    valueLabel.textContent = normalized;
    onChange(normalized);
  };

  input.addEventListener('input', () => update(input.value));

  return { input, valueLabel };
};

const setSliderHandleValue = (handle: ControlHandle, value: number) => {
  handle.input.value = String(value);
  handle.valueLabel.textContent = formatNumber(value);
};

const setColorHandleValue = (handle: ControlHandle, hex: string) => {
  const normalized = hex.startsWith('#') ? hex.toUpperCase() : `#${hex.toUpperCase()}`;
  handle.input.value = normalized;
  handle.valueLabel.textContent = normalized;
};

export function createQuaternionPreview(
  container: HTMLElement,
  options: QuaternionPreviewOptions = {}
) {
  const root = document.createElement('div');
  root.className = 'quaternion-preview';

  const heading = document.createElement('h2');
  heading.textContent = options.heading ?? 'Quaternion Fabric Preview';
  root.appendChild(heading);

  const layout = document.createElement('div');
  layout.className = 'qp-layout';
  root.appendChild(layout);

  const controls = document.createElement('div');
  controls.className = 'qp-controls';
  layout.appendChild(controls);

  const defaultPreset = PREVIEW_PRESETS[0];
  const CUSTOM_PRESET_ID = 'custom';
  const customPresetDescription =
    'Custom configuration — manual overrides not captured by curated presets.';

  const layerStates: LayerState[] = LAYER_BLUEPRINTS.map((blueprint, index) => {
    const presetLayer = defaultPreset?.layers[index];
    return {
      geometry: presetLayer?.geometry ?? blueprint.geometry,
      projection: presetLayer?.projection ?? blueprint.projection,
      material: presetLayer
        ? cloneMaterialControl(presetLayer.material)
        : createDefaultLayerMaterialControl(index, LAYER_BLUEPRINTS.length),
    } satisfies LayerState;
  });

  const layerGeometryHandles: Array<SelectHandle<GlassGeometryModule> | null> = [];
  const layerProjectionHandles: Array<SelectHandle<GlassProjectionModule> | null> = [];
  const layerMaterialHandles: Array<LayerMaterialHandles | null> = [];

  const presetSelectOptions = [
    ...PREVIEW_PRESETS.map(preset => ({ value: preset.id, label: preset.label })),
    { value: CUSTOM_PRESET_ID, label: 'Custom blend' },
  ] as const;

  const presetSelect = createSelect(
    controls,
    'Layer preset',
    presetSelectOptions,
    defaultPreset?.id ?? CUSTOM_PRESET_ID,
  );

  const presetDescription = document.createElement('p');
  presetDescription.className = 'qp-preset-description';
  presetDescription.textContent = defaultPreset?.description ?? customPresetDescription;
  controls.appendChild(presetDescription);

  let activePresetId = defaultPreset?.id ?? CUSTOM_PRESET_ID;

  const markPresetAsCustom = () => {
    if (activePresetId === CUSTOM_PRESET_ID) {
      return;
    }
    activePresetId = CUSTOM_PRESET_ID;
    presetSelect.select.value = CUSTOM_PRESET_ID;
    presetDescription.textContent = customPresetDescription;
  };

  let fallbackMaterialOverrides: MaterialOverrides = toFallbackOverrides(layerStates[0]?.material ?? {
    primaryColor: '#FFFFFF',
    secondaryColor: '#FFFFFF',
    backgroundColor: '#000000',
    patternIntensity: 1,
    glitchIntensity: 0,
    colorShift: 0,
    gridDensity: 8,
    lineThickness: 0.02,
    shellWidth: 0.02,
    tetraThickness: 0.03,
  });

  const buildLayerDescriptors = (): LayerDescriptor[] =>
    LAYER_BLUEPRINTS.map((blueprint, index) => ({
      name: blueprint.name,
      pipelineLabel: blueprint.pipelineLabel,
      blurRadius: blueprint.blurRadius,
      shader: {
        geometry: layerStates[index]?.geometry ?? blueprint.geometry,
        projection: layerStates[index]?.projection ?? blueprint.projection,
      },
      material: toMaterialConfig(layerStates[index]?.material ?? createDefaultLayerMaterialControl(index, LAYER_BLUEPRINTS.length)),
    }));

  const applyLayerMaterial = (index: number) => {
    if (index < 0 || index >= layerStates.length) {
      return;
    }
    const material = layerStates[index]?.material;
    if (!material) {
      return;
    }
    const update = toMaterialUpdate(material);
    if (webgpuHarness) {
      webgpuHarness.updateLayerMaterial(index, update);
    }
    if (index === 0) {
      fallbackMaterialOverrides = toFallbackOverrides(material);
      if (webglFallback) {
        webglFallback.setMaterialOverrides(fallbackMaterialOverrides);
      }
    }
  };

  const applyAllLayerMaterials = () => {
    layerStates.forEach((_, index) => applyLayerMaterial(index));
    if (webglFallback) {
      webglFallback.setMaterialOverrides(fallbackMaterialOverrides);
    }
  };

  const geometryOptions: { value: GlassGeometryModule; label: string }[] = [
    { value: 'hypercube', label: 'Hypercube lattice' },
    { value: 'hypersphere', label: 'Hypersphere lattice' },
    { value: 'hypertetrahedron', label: 'Hypertetra lattice' },
  ];

  const projectionOptions: { value: GlassProjectionModule; label: string }[] = [
    { value: 'perspective', label: 'Perspective projection' },
    { value: 'orthographic', label: 'Orthographic projection' },
    { value: 'stereographic', label: 'Stereographic projection' },
  ];

  let activeRenderer: 'webgpu' | 'webgl' | 'none' = 'none';
  let selectedGeometry: GlassGeometryModule = layerStates[0]?.geometry ?? 'hypersphere';
  let selectedProjection: GlassProjectionModule = layerStates[0]?.projection ?? 'perspective';

  const geometrySelect = createSelect(controls, 'Geometry preset', geometryOptions, selectedGeometry);
  const projectionSelect = createSelect(controls, 'Projection preset', projectionOptions, selectedProjection);

  const layerPanel = document.createElement('section');
  layerPanel.className = 'qp-layer-panel';
  const layerHeading = document.createElement('h3');
  layerHeading.textContent = 'Layer stack controls';
  layerPanel.appendChild(layerHeading);

  const layerList = document.createElement('div');
  layerList.className = 'qp-layer-list';
  layerPanel.appendChild(layerList);
  controls.appendChild(layerPanel);

  layerStates.forEach((state, index) => {
    const blueprint = LAYER_BLUEPRINTS[index];
    const card = document.createElement('details');
    card.className = 'qp-layer-card';
    card.open = index === 0;

    const summary = document.createElement('summary');
    summary.textContent = `${index + 1}. ${blueprint.name}`;
    card.appendChild(summary);

    const body = document.createElement('div');
    body.className = 'qp-layer-body';
    card.appendChild(body);

    const geometryHandle = createSelect(body, 'Geometry module', geometryOptions, state.geometry);
    geometryHandle.select.addEventListener('change', () => {
      markPresetAsCustom();
      state.geometry = geometryHandle.getValue();
      layerGeometryHandles[index] = geometryHandle;
      if (index === 0) {
        selectedGeometry = state.geometry;
        geometrySelect.select.value = state.geometry;
      }
      void rebuildRenderer(activeRenderer !== 'webgl');
    });
    layerGeometryHandles[index] = geometryHandle;

    const projectionHandle = createSelect(body, 'Projection module', projectionOptions, state.projection);
    projectionHandle.select.addEventListener('change', () => {
      markPresetAsCustom();
      state.projection = projectionHandle.getValue();
      layerProjectionHandles[index] = projectionHandle;
      if (index === 0) {
        selectedProjection = state.projection;
        projectionSelect.select.value = state.projection;
      }
      void rebuildRenderer(activeRenderer !== 'webgl');
    });
    layerProjectionHandles[index] = projectionHandle;

    const primaryHandle = createColorControl(body, 'Primary color', state.material.primaryColor, next => {
      markPresetAsCustom();
      state.material.primaryColor = next;
      applyLayerMaterial(index);
    });

    const secondaryHandle = createColorControl(body, 'Secondary color', state.material.secondaryColor, next => {
      markPresetAsCustom();
      state.material.secondaryColor = next;
      applyLayerMaterial(index);
    });

    const backgroundHandle = createColorControl(body, 'Background color', state.material.backgroundColor, next => {
      markPresetAsCustom();
      state.material.backgroundColor = next;
      applyLayerMaterial(index);
    });

    const patternSlider = createSlider(body, 'Pattern intensity', {
      min: 0,
      max: 2,
      step: 0.01,
      value: state.material.patternIntensity,
    });
    patternSlider.input.addEventListener('input', () => {
      markPresetAsCustom();
      state.material.patternIntensity = Number(patternSlider.input.value);
      applyLayerMaterial(index);
    });

    const glitchSlider = createSlider(body, 'Glitch intensity', {
      min: 0,
      max: 1,
      step: 0.01,
      value: state.material.glitchIntensity,
    });
    glitchSlider.input.addEventListener('input', () => {
      markPresetAsCustom();
      state.material.glitchIntensity = Number(glitchSlider.input.value);
      applyLayerMaterial(index);
    });

    const colorShiftSlider = createSlider(body, 'Color shift', {
      min: -1,
      max: 1,
      step: 0.01,
      value: state.material.colorShift,
    });
    colorShiftSlider.input.addEventListener('input', () => {
      markPresetAsCustom();
      state.material.colorShift = Number(colorShiftSlider.input.value);
      applyLayerMaterial(index);
    });

    const gridSlider = createSlider(body, 'Grid density', {
      min: 2,
      max: 18,
      step: 0.1,
      value: state.material.gridDensity,
    });
    gridSlider.input.addEventListener('input', () => {
      markPresetAsCustom();
      state.material.gridDensity = Number(gridSlider.input.value);
      applyLayerMaterial(index);
    });

    const lineSlider = createSlider(body, 'Line thickness', {
      min: 0.005,
      max: 0.08,
      step: 0.001,
      value: state.material.lineThickness,
    });
    lineSlider.input.addEventListener('input', () => {
      markPresetAsCustom();
      state.material.lineThickness = Number(lineSlider.input.value);
      applyLayerMaterial(index);
    });

    const shellSlider = createSlider(body, 'Shell width', {
      min: 0.005,
      max: 0.08,
      step: 0.001,
      value: state.material.shellWidth,
    });
    shellSlider.input.addEventListener('input', () => {
      markPresetAsCustom();
      state.material.shellWidth = Number(shellSlider.input.value);
      applyLayerMaterial(index);
    });

    const tetraSlider = createSlider(body, 'Tetra thickness', {
      min: 0.005,
      max: 0.08,
      step: 0.001,
      value: state.material.tetraThickness,
    });
    tetraSlider.input.addEventListener('input', () => {
      markPresetAsCustom();
      state.material.tetraThickness = Number(tetraSlider.input.value);
      applyLayerMaterial(index);
    });

    layerMaterialHandles[index] = {
      primary: primaryHandle,
      secondary: secondaryHandle,
      background: backgroundHandle,
      pattern: patternSlider,
      glitch: glitchSlider,
      colorShift: colorShiftSlider,
      grid: gridSlider,
      line: lineSlider,
      shell: shellSlider,
      tetra: tetraSlider,
    };

    layerList.appendChild(card);
  });

  const systemsColumn = document.createElement('div');
  systemsColumn.className = 'qp-systems';
  layout.appendChild(systemsColumn);

  const statusPanel = document.createElement('div');
  statusPanel.className = 'qp-status';
  root.appendChild(statusPanel);

  const webgpuSection = document.createElement('section');
  webgpuSection.className = 'qp-webgpu';

  const webgpuHeading = document.createElement('h3');
  webgpuHeading.textContent = 'WebGPU Glass Composer Preview';
  webgpuSection.appendChild(webgpuHeading);

  const webgpuCanvas = document.createElement('canvas');
  webgpuCanvas.className = 'qp-webgpu-canvas';
  webgpuSection.appendChild(webgpuCanvas);

  const webgpuStatus = document.createElement('p');
  webgpuStatus.className = 'qp-webgpu-status';
  webgpuStatus.textContent = 'Checking WebGPU support…';
  webgpuSection.appendChild(webgpuStatus);

  const webgpuFps = document.createElement('p');
  webgpuFps.className = 'qp-webgpu-fps';
  webgpuFps.textContent = 'FPS';
  const webgpuFpsValue = document.createElement('span');
  webgpuFpsValue.className = 'qp-webgpu-fps-value';
  webgpuFpsValue.textContent = '0.0';
  webgpuFps.appendChild(webgpuFpsValue);
  webgpuSection.appendChild(webgpuFps);

  const riskList = document.createElement('ul');
  riskList.className = 'qp-risk-list';
  webgpuSection.appendChild(riskList);

  statusPanel.appendChild(webgpuSection);

  const storySection = document.createElement('section');
  storySection.className = 'qp-story';
  const storyHeading = document.createElement('h3');
  storyHeading.textContent = 'Active Story Events';
  storySection.appendChild(storyHeading);

  const storyList = document.createElement('ul');
  storyList.className = 'qp-story-list';
  storySection.appendChild(storyList);

  statusPanel.appendChild(storySection);

  const updateRiskList = (risks: string[]) => {
    riskList.textContent = '';
    if (risks.length === 0) {
      const okItem = document.createElement('li');
      okItem.textContent = 'No configuration risks detected for current layer plan.';
      riskList.appendChild(okItem);
      return;
    }
    risks.forEach(risk => {
      const item = document.createElement('li');
      item.textContent = risk;
      riskList.appendChild(item);
    });
  };

  const updateStoryList = (activations: StoryTriggerActivation[]) => {
    storyList.textContent = '';
    if (!activations.length) {
      const idle = document.createElement('li');
      idle.textContent = 'Story graph idle — no triggers active.';
      storyList.appendChild(idle);
      return;
    }
    activations.forEach(activation => {
      const item = document.createElement('li');
      const intensity = Math.round(clamp01(activation.intensity) * 100);
      const detailEntries = activation.details
        ? Object.entries(activation.details)
            .map(([key, value]) => `${key}: ${typeof value === 'number' ? formatNumber(value as number) : String(value)}`)
            .join(' • ')
        : '';
      const meta = detailEntries ? ` • ${detailEntries}` : '';
      item.textContent = `${activation.label} — ${intensity}%${meta}`;
      storyList.appendChild(item);
    });
  };

  let webgpuHarness: WebGPUPreviewHarness | null = null;
  let webglFallback: WebGLFallbackPreview | null = null;

  const navigatorWithGPU =
    (typeof navigator !== 'undefined'
      ? (navigator as Navigator & { gpu?: { requestAdapter?: (options?: unknown) => Promise<unknown> } })
      : undefined);

  let rendererGeneration = 0;

  const teardownWebGPU = () => {
    if (!webgpuHarness) {
      return;
    }
    webgpuHarness.stop();
    webgpuHarness.dispose();
    webgpuHarness = null;
  };

  const teardownWebGL = () => {
    if (!webglFallback) {
      return;
    }
    webglFallback.dispose();
    webglFallback = null;
  };

  const startWebGLFallback = () => {
    teardownWebGL();
    teardownWebGPU();
    try {
      webglFallback = new WebGLFallbackPreview({
        canvas: webgpuCanvas,
        geometry: layerStates[0]?.geometry ?? selectedGeometry,
        projection: layerStates[0]?.projection ?? selectedProjection,
        onFrame: ({ fps }) => {
          webgpuFpsValue.textContent = fps.toFixed(1);
          if (webglFallback) {
            updateRiskList(webglFallback.listRisks());
            updateStoryList(webglFallback.listStoryActivations());
            updatePrediction(webglFallback.getPredictionSnapshot());
          }
        }
      });
      webglFallback.setMaterialOverrides(fallbackMaterialOverrides);
      webglFallback.start();
      activeRenderer = 'webgl';
      webgpuStatus.textContent = 'WebGPU unavailable — showing WebGL fallback shader.';
      updateRiskList(webglFallback.listRisks());
      updateStoryList(webglFallback.listStoryActivations());
      applyLayerMaterial(0);
      emitUpdate();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      webgpuStatus.textContent = `WebGL fallback failed: ${message}`;
      updateRiskList([]);
      updateStoryList([]);
    }
  };

  const rebuildRenderer = async (preferWebGPU: boolean) => {
    const navGpu = navigatorWithGPU?.gpu;
    const generation = ++rendererGeneration;

    if (preferWebGPU && navGpu?.requestAdapter) {
      try {
        teardownWebGL();
        teardownWebGPU();
        webgpuStatus.textContent = 'Initializing WebGPU glass composer…';
        const harness = await WebGPUPreviewHarness.create({
          canvas: webgpuCanvas,
          layers: buildLayerDescriptors(),
          onFrame: ({ fps }) => {
            webgpuFpsValue.textContent = fps.toFixed(1);
            if (webgpuHarness) {
              updateRiskList(webgpuHarness.listRisks());
              updateStoryList(webgpuHarness.listStoryActivations());
              updatePrediction(webgpuHarness.getPredictionSnapshot());
            }
          }
        });

        if (generation !== rendererGeneration) {
          harness.stop();
          harness.dispose();
          return;
        }

        webgpuHarness = harness;
        activeRenderer = 'webgpu';
        applyAllLayerMaterials();
        updateRiskList(webgpuHarness.listRisks());
        updateStoryList(webgpuHarness.listStoryActivations());
        webgpuStatus.textContent = 'WebGPU glass composer ready.';
        webgpuHarness.start();
        emitUpdate();
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        webgpuStatus.textContent = `WebGPU init failed: ${message}`;
        webgpuHarness = null;
      }
    }

    startWebGLFallback();
  };

  const applyPreset = (preset: PreviewPreset) => {
    activePresetId = preset.id;
    presetSelect.select.value = preset.id;
    presetDescription.textContent = preset.description;

    let geometryChanged = false;

    LAYER_BLUEPRINTS.forEach((blueprint, index) => {
      const state = layerStates[index];
      if (!state) {
        return;
      }

      const presetLayer = preset.layers[index];
      const nextGeometry = presetLayer?.geometry ?? blueprint.geometry;
      const nextProjection = presetLayer?.projection ?? blueprint.projection;
      const nextMaterial = presetLayer?.material
        ? cloneMaterialControl(presetLayer.material)
        : createDefaultLayerMaterialControl(index, LAYER_BLUEPRINTS.length);

      if (state.geometry !== nextGeometry) {
        state.geometry = nextGeometry;
        geometryChanged = true;
      }
      if (state.projection !== nextProjection) {
        state.projection = nextProjection;
        geometryChanged = true;
      }

      state.material = nextMaterial;

      const geometryHandle = layerGeometryHandles[index];
      if (geometryHandle && geometryHandle.select.value !== state.geometry) {
        geometryHandle.select.value = state.geometry;
      }
      const projectionHandle = layerProjectionHandles[index];
      if (projectionHandle && projectionHandle.select.value !== state.projection) {
        projectionHandle.select.value = state.projection;
      }

      const materialHandles = layerMaterialHandles[index];
      if (materialHandles) {
        setColorHandleValue(materialHandles.primary, state.material.primaryColor);
        setColorHandleValue(materialHandles.secondary, state.material.secondaryColor);
        setColorHandleValue(materialHandles.background, state.material.backgroundColor);
        setSliderHandleValue(materialHandles.pattern, state.material.patternIntensity);
        setSliderHandleValue(materialHandles.glitch, state.material.glitchIntensity);
        setSliderHandleValue(materialHandles.colorShift, state.material.colorShift);
        setSliderHandleValue(materialHandles.grid, state.material.gridDensity);
        setSliderHandleValue(materialHandles.line, state.material.lineThickness);
        setSliderHandleValue(materialHandles.shell, state.material.shellWidth);
        setSliderHandleValue(materialHandles.tetra, state.material.tetraThickness);
      }
    });

    selectedGeometry = layerStates[0]?.geometry ?? selectedGeometry;
    selectedProjection = layerStates[0]?.projection ?? selectedProjection;
    geometrySelect.select.value = selectedGeometry;
    projectionSelect.select.value = selectedProjection;

    applyAllLayerMaterials();

    if (geometryChanged) {
      void rebuildRenderer(activeRenderer !== 'webgl');
    } else if (activeRenderer === 'webgpu' && webgpuHarness) {
      updateRiskList(webgpuHarness.listRisks());
      updateStoryList(webgpuHarness.listStoryActivations());
    } else if (activeRenderer === 'webgl' && webglFallback) {
      updateRiskList(webglFallback.listRisks());
      updateStoryList(webglFallback.listStoryActivations());
    }
  };

  presetSelect.select.addEventListener('change', () => {
    const presetId = presetSelect.getValue();
    if (presetId === CUSTOM_PRESET_ID) {
      activePresetId = CUSTOM_PRESET_ID;
      presetDescription.textContent = customPresetDescription;
      return;
    }

    const preset = PREVIEW_PRESETS.find(candidate => candidate.id === presetId);
    if (preset) {
      applyPreset(preset);
    }
  });

  if (typeof window !== 'undefined') {
    window.addEventListener('resize', () => webgpuHarness?.forceResize());
  }

  const initialAngles = options.initialAngles ?? { yaw: 20, pitch: 12, roll: -18 };
  const yaw = createSlider(controls, 'Yaw (°)', { min: -180, max: 180, step: 1, value: initialAngles.yaw });
  const pitch = createSlider(controls, 'Pitch (°)', { min: -90, max: 90, step: 1, value: initialAngles.pitch });
  const roll = createSlider(controls, 'Roll (°)', { min: -180, max: 180, step: 1, value: initialAngles.roll });
  const confidence = createSlider(controls, 'Confidence', { min: 0, max: 1, step: 0.05, value: options.initialConfidence ?? 0.85 });

  const pulseButton = document.createElement('button');
  pulseButton.className = 'qp-button';
  pulseButton.type = 'button';
  pulseButton.textContent = 'Pulse Update';
  controls.appendChild(pulseButton);

  const bridge = new SensoryInputBridge({
    autoConnectAdapters: false,
    confidenceThreshold: 0,
    channelHistoryLimit: 4
  });

  const systems = {
    quantum: new MockQuaternionSystem('Quantum Engine', systemsColumn, {
      rot4dXW: 0,
      rot4dYW: 0,
      rot4dZW: 0,
      chaos: 0.2,
      intensity: 0.7
    }),
    holographic: new MockQuaternionSystem('Holographic Engine', systemsColumn, {
      rot4dXW: 0,
      rot4dYW: 0,
      rot4dZW: 0,
      hue: 320,
      saturation: 0.9
    }),
    faceted: new MockQuaternionSystem('Faceted System', systemsColumn, {
      rot4dXW: 0,
      rot4dYW: 0,
      rot4dZW: 0,
      speed: 1
    })
  } satisfies Record<string, MockQuaternionSystem>;

  const synchronizer = new ShaderQuaternionSynchronizer({
    bridge,
    systems,
    baseAlpha: 0.3,
    minConfidence: 0.05,
    energySmoothing: 0.25,
    velocityReference: 6
  });

  synchronizer.start();

  const statusText = document.createElement('p');
  statusText.className = 'qp-status-line';
  statusPanel.appendChild(statusText);

  const predictionText = document.createElement('p');
  predictionText.className = 'qp-status-line';
  statusPanel.appendChild(predictionText);

  const lastQuaternion = document.createElement('pre');
  lastQuaternion.className = 'qp-quaternion';
  statusPanel.appendChild(lastQuaternion);

  const emitUpdate = () => {
    const yawValue = Number(yaw.input.value);
    const pitchValue = Number(pitch.input.value);
    const rollValue = Number(roll.input.value);
    const confidenceValue = Number(confidence.input.value);

    const quaternion = eulerToQuaternion(yawValue, pitchValue, rollValue);
    const quatTuple: [number, number, number, number] = [
      quaternion.x,
      quaternion.y,
      quaternion.z,
      quaternion.w
    ];

    const energy = clamp01(Math.abs(synchronizer.motionEnergy) / 4);
    const audioBands = {
      bass: clamp01(Math.abs(quaternion.x) * 0.8 + energy * 0.25),
      mid: clamp01(Math.abs(quaternion.y) * 0.8 + energy * 0.2),
      high: clamp01(Math.abs(quaternion.z) * 0.8 + energy * 0.35),
      energy
    } as const;
    const morphFactor = clamp01(
      (Math.abs(pitchValue) / 90 + Math.abs(rollValue) / 180) * 0.5 + energy * 0.3
    );
    const visualVector = {
      dimension: 3.2 + energy * 1.8,
      morphFactor,
      rotationSpeed: 0.2 + energy * 1.4,
      universeModifier: 1 + energy * 0.5
    } as const;

    bridge.ingest(
      'spatial.pose',
      {
        orientation: quaternion,
        position: { x: 0, y: 0, z: 0 },
        timestamp: performance.now()
      },
      confidenceValue
    );

    if (webgpuHarness) {
      webgpuHarness.setQuaternion(quatTuple);
      webgpuHarness.setConfidence(confidenceValue);
      webgpuHarness.setAudioBands(audioBands);
      webgpuHarness.setVisualParams(visualVector);
    }

    if (webglFallback) {
      webglFallback.setQuaternion(quatTuple);
      webglFallback.setConfidence(confidenceValue);
      webglFallback.setAudioBands(audioBands);
      webglFallback.setVisualParams(visualVector);
    }

    statusText.textContent = `Confidence ${formatNumber(confidenceValue)} • Motion energy ${formatNumber(
      synchronizer.motionEnergy
    )}`;

    updatePrediction(webgpuHarness?.getPredictionSnapshot() ?? webglFallback?.getPredictionSnapshot() ?? null);

    lastQuaternion.textContent = JSON.stringify(quaternion, null, 2);
  };

  const updatePrediction = (
    snapshot: ReturnType<WebGPUPreviewHarness['getPredictionSnapshot']> | null
  ) => {
    if (!snapshot) {
      predictionText.textContent = 'Predictive rotor cache warming — awaiting samples.';
      return;
    }
    const [xw, yw, zw] = snapshot.rotor;
    predictionText.textContent = `Predictive horizon ${formatNumber(snapshot.horizonMs)} ms • Confidence ${Math.round(
      clamp01(snapshot.confidence) * 100
    )}% • Rotor [${formatNumber(xw)}, ${formatNumber(yw)}, ${formatNumber(zw)}]`;
  };

  const handleInput = () => {
    emitUpdate();
  };

  yaw.input.addEventListener('input', handleInput);
  pitch.input.addEventListener('input', handleInput);
  roll.input.addEventListener('input', handleInput);
  confidence.input.addEventListener('input', handleInput);
  geometrySelect.select.addEventListener('change', () => {
    markPresetAsCustom();
    selectedGeometry = geometrySelect.getValue();
    if (layerStates[0]) {
      layerStates[0].geometry = selectedGeometry;
    }
    const primaryHandle = layerGeometryHandles[0];
    if (primaryHandle && primaryHandle.select.value !== selectedGeometry) {
      primaryHandle.select.value = selectedGeometry;
    }
    void rebuildRenderer(activeRenderer !== 'webgl');
  });
  projectionSelect.select.addEventListener('change', () => {
    markPresetAsCustom();
    selectedProjection = projectionSelect.getValue();
    if (layerStates[0]) {
      layerStates[0].projection = selectedProjection;
    }
    const primaryHandle = layerProjectionHandles[0];
    if (primaryHandle && primaryHandle.select.value !== selectedProjection) {
      primaryHandle.select.value = selectedProjection;
    }
    void rebuildRenderer(activeRenderer !== 'webgl');
  });
  pulseButton.addEventListener('click', () => {
    emitUpdate();
    webgpuHarness?.pulse(0.9);
    webglFallback?.pulse(0.9);
  });

  container.appendChild(root);
  emitUpdate();

  void rebuildRenderer(true);

  return {
    bridge,
    synchronizer,
    destroy() {
      synchronizer.stop();
      systems.quantum.destroy();
      systems.holographic.destroy();
      systems.faceted.destroy();
      teardownWebGPU();
      teardownWebGL();
      container.removeChild(root);
    }
  };
}
