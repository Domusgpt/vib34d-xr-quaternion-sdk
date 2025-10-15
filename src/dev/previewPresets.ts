import type {
  GlassGeometryModule,
  GlassProjectionModule,
} from '../ui/adaptive/renderers/webgpu/GlassShaderLibrary.ts';

export interface PresetLayerMaterial {
  readonly primaryColor: string;
  readonly secondaryColor: string;
  readonly backgroundColor: string;
  readonly patternIntensity: number;
  readonly glitchIntensity: number;
  readonly colorShift: number;
  readonly gridDensity: number;
  readonly lineThickness: number;
  readonly shellWidth: number;
  readonly tetraThickness: number;
}

export interface PreviewPresetLayer {
  readonly geometry: GlassGeometryModule;
  readonly projection: GlassProjectionModule;
  readonly material: PresetLayerMaterial;
}

export interface PreviewPreset {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly layers: readonly PreviewPresetLayer[];
}

export const PREVIEW_PRESETS: readonly PreviewPreset[] = [
  {
    id: 'aurora-cascade',
    label: 'Aurora Cascade',
    description:
      'Balanced baseline tuned for calibration — softly saturated colors, moderate blur, and conservative glitch for quick shader verification.',
    layers: [
      {
        geometry: 'hypersphere',
        projection: 'perspective',
        material: {
          primaryColor: '#8270C8',
          secondaryColor: '#73B997',
          backgroundColor: '#131F1C',
          patternIntensity: 0.7917,
          glitchIntensity: 0.1167,
          colorShift: -0.1333,
          gridDensity: 8.6667,
          lineThickness: 0.02167,
          shellWidth: 0.0325,
          tetraThickness: 0.03167,
        },
      },
      {
        geometry: 'hypercube',
        projection: 'orthographic',
        material: {
          primaryColor: '#918BBC',
          secondaryColor: '#98A6A2',
          backgroundColor: '#1A1B24',
          patternIntensity: 0.7333,
          glitchIntensity: 0.1033,
          colorShift: -0.0667,
          gridDensity: 9.3333,
          lineThickness: 0.02333,
          shellWidth: 0.03,
          tetraThickness: 0.03333,
        },
      },
      {
        geometry: 'hypertetrahedron',
        projection: 'stereographic',
        material: {
          primaryColor: '#9F84A9',
          secondaryColor: '#A68AAC',
          backgroundColor: '#20172A',
          patternIntensity: 0.675,
          glitchIntensity: 0.09,
          colorShift: 0,
          gridDensity: 10,
          lineThickness: 0.025,
          shellWidth: 0.0275,
          tetraThickness: 0.035,
        },
      },
      {
        geometry: 'hypercube',
        projection: 'perspective',
        material: {
          primaryColor: '#AE5F93',
          secondaryColor: '#986BB7',
          backgroundColor: '#26132F',
          patternIntensity: 0.6167,
          glitchIntensity: 0.0767,
          colorShift: 0.0667,
          gridDensity: 10.6667,
          lineThickness: 0.02667,
          shellWidth: 0.025,
          tetraThickness: 0.03667,
        },
      },
      {
        geometry: 'hypersphere',
        projection: 'orthographic',
        material: {
          primaryColor: '#BD2C7C',
          secondaryColor: '#734CC1',
          backgroundColor: '#2D0E32',
          patternIntensity: 0.5583,
          glitchIntensity: 0.0633,
          colorShift: 0.1333,
          gridDensity: 11.3333,
          lineThickness: 0.02833,
          shellWidth: 0.0225,
          tetraThickness: 0.03833,
        },
      },
    ],
  },
  {
    id: 'nebula-mirage',
    label: 'Nebula Mirage',
    description:
      'High-energy neon wash with aggressive glitching and stereographic parallax — useful for stress testing blur feedback loops.',
    layers: [
      {
        geometry: 'hypercube',
        projection: 'stereographic',
        material: {
          primaryColor: '#1BFFF2',
          secondaryColor: '#FF77C8',
          backgroundColor: '#051028',
          patternIntensity: 1.24,
          glitchIntensity: 0.32,
          colorShift: 0.22,
          gridDensity: 13.5,
          lineThickness: 0.018,
          shellWidth: 0.024,
          tetraThickness: 0.027,
        },
      },
      {
        geometry: 'hypertetrahedron',
        projection: 'perspective',
        material: {
          primaryColor: '#4EF8FF',
          secondaryColor: '#FF9A62',
          backgroundColor: '#09142E',
          patternIntensity: 1.08,
          glitchIntensity: 0.28,
          colorShift: -0.18,
          gridDensity: 12.4,
          lineThickness: 0.0205,
          shellWidth: 0.021,
          tetraThickness: 0.031,
        },
      },
      {
        geometry: 'hypersphere',
        projection: 'orthographic',
        material: {
          primaryColor: '#2C9DFF',
          secondaryColor: '#F25CFF',
          backgroundColor: '#0C0F2B',
          patternIntensity: 1.16,
          glitchIntensity: 0.25,
          colorShift: 0.12,
          gridDensity: 14.2,
          lineThickness: 0.022,
          shellWidth: 0.019,
          tetraThickness: 0.0295,
        },
      },
      {
        geometry: 'hypertetrahedron',
        projection: 'stereographic',
        material: {
          primaryColor: '#4BFFB5',
          secondaryColor: '#FF4F8B',
          backgroundColor: '#111134',
          patternIntensity: 1.05,
          glitchIntensity: 0.34,
          colorShift: -0.24,
          gridDensity: 13.1,
          lineThickness: 0.0195,
          shellWidth: 0.0205,
          tetraThickness: 0.028,
        },
      },
      {
        geometry: 'hypercube',
        projection: 'perspective',
        material: {
          primaryColor: '#34E5FF',
          secondaryColor: '#FF7AF4',
          backgroundColor: '#07122D',
          patternIntensity: 1.18,
          glitchIntensity: 0.29,
          colorShift: 0.16,
          gridDensity: 14.6,
          lineThickness: 0.0215,
          shellWidth: 0.0185,
          tetraThickness: 0.0305,
        },
      },
    ],
  },
  {
    id: 'obsidian-bloom',
    label: 'Obsidian Bloom',
    description:
      'Low-glitch cinematic palette with deeper backgrounds and slow morphing rotations for narrative scene blocking.',
    layers: [
      {
        geometry: 'hypersphere',
        projection: 'orthographic',
        material: {
          primaryColor: '#4C6FFF',
          secondaryColor: '#F0A7FF',
          backgroundColor: '#090711',
          patternIntensity: 0.88,
          glitchIntensity: 0.08,
          colorShift: -0.05,
          gridDensity: 7.8,
          lineThickness: 0.024,
          shellWidth: 0.036,
          tetraThickness: 0.034,
        },
      },
      {
        geometry: 'hypertetrahedron',
        projection: 'orthographic',
        material: {
          primaryColor: '#5A4BFF',
          secondaryColor: '#FF9FD6',
          backgroundColor: '#100715',
          patternIntensity: 0.74,
          glitchIntensity: 0.06,
          colorShift: -0.12,
          gridDensity: 8.6,
          lineThickness: 0.026,
          shellWidth: 0.033,
          tetraThickness: 0.0325,
        },
      },
      {
        geometry: 'hypercube',
        projection: 'perspective',
        material: {
          primaryColor: '#4832FF',
          secondaryColor: '#F7C6FF',
          backgroundColor: '#0C071B',
          patternIntensity: 0.69,
          glitchIntensity: 0.052,
          colorShift: 0.04,
          gridDensity: 9.4,
          lineThickness: 0.027,
          shellWidth: 0.0315,
          tetraThickness: 0.0355,
        },
      },
      {
        geometry: 'hypersphere',
        projection: 'perspective',
        material: {
          primaryColor: '#3C2AD9',
          secondaryColor: '#E6B1FF',
          backgroundColor: '#08061A',
          patternIntensity: 0.64,
          glitchIntensity: 0.045,
          colorShift: 0.09,
          gridDensity: 10.1,
          lineThickness: 0.028,
          shellWidth: 0.029,
          tetraThickness: 0.036,
        },
      },
      {
        geometry: 'hypertetrahedron',
        projection: 'stereographic',
        material: {
          primaryColor: '#3320C6',
          secondaryColor: '#DDA4FF',
          backgroundColor: '#070515',
          patternIntensity: 0.6,
          glitchIntensity: 0.04,
          colorShift: -0.08,
          gridDensity: 9.8,
          lineThickness: 0.029,
          shellWidth: 0.028,
          tetraThickness: 0.0345,
        },
      },
    ],
  },
] as const;

export const findPreviewPreset = (id: string): PreviewPreset | undefined =>
  PREVIEW_PRESETS.find(preset => preset.id === id);
