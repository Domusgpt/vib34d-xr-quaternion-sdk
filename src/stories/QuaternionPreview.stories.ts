import type { Meta, StoryObj } from '@storybook/html';
import { createQuaternionPreview } from '../dev/quaternionPreview.js';
import '../dev/main.css';

type PreviewArgs = {
  heading: string;
  yaw: number;
  pitch: number;
  roll: number;
  confidence: number;
  system: 'quantum' | 'holographic' | 'faceted' | 'polychora';
  rot4dXY: number;
  rot4dXZ: number;
  rot4dYZ: number;
  rot4dXW: number;
  rot4dYW: number;
  rot4dZW: number;
};

const meta: Meta<PreviewArgs> = {
  title: 'XR/Quaternion Fabric/Preview',
  parameters: {
    layout: 'centered'
  },
  render: args => {
    const host = document.createElement('div');
    createQuaternionPreview(host, {
      heading: args.heading,
      initialAngles: {
        yaw: args.yaw,
        pitch: args.pitch,
        roll: args.roll
      },
      initialConfidence: args.confidence,
      initialSystem: args.system,
      initialRotor: {
        xy: args.rot4dXY,
        xz: args.rot4dXZ,
        yz: args.rot4dYZ,
        xw: args.rot4dXW,
        yw: args.rot4dYW,
        zw: args.rot4dZW,
      },
    });
    return host;
  },
  argTypes: {
    heading: { control: 'text' },
    yaw: { control: { type: 'range', min: -180, max: 180, step: 1 } },
    pitch: { control: { type: 'range', min: -90, max: 90, step: 1 } },
    roll: { control: { type: 'range', min: -180, max: 180, step: 1 } },
    confidence: { control: { type: 'range', min: 0, max: 1, step: 0.05 } },
    system: {
      control: {
        type: 'inline-radio',
        options: ['quantum', 'holographic', 'faceted', 'polychora'],
      },
    },
    rot4dXY: { control: { type: 'range', min: -6.28, max: 6.28, step: 0.01 } },
    rot4dXZ: { control: { type: 'range', min: -6.28, max: 6.28, step: 0.01 } },
    rot4dYZ: { control: { type: 'range', min: -6.28, max: 6.28, step: 0.01 } },
    rot4dXW: { control: { type: 'range', min: -6.28, max: 6.28, step: 0.01 } },
    rot4dYW: { control: { type: 'range', min: -6.28, max: 6.28, step: 0.01 } },
    rot4dZW: { control: { type: 'range', min: -6.28, max: 6.28, step: 0.01 } },
  },
  args: {
    heading: 'Storybook Quaternion Preview',
    yaw: 30,
    pitch: 8,
    roll: -14,
    confidence: 0.82,
    system: 'quantum',
    rot4dXY: 0,
    rot4dXZ: 0,
    rot4dYZ: 0,
    rot4dXW: 0,
    rot4dYW: 0,
    rot4dZW: 0,
  }
};

export default meta;

type Story = StoryObj<PreviewArgs>;

export const Default: Story = {};

export const HighMotionEnergy: Story = {
  args: {
    yaw: 120,
    pitch: 40,
    roll: 60,
    confidence: 0.95
  }
};

export const LowConfidenceDrift: Story = {
  args: {
    yaw: -25,
    pitch: -6,
    roll: 18,
    confidence: 0.35
  }
};

export const SixPlaneRotor: Story = {
  args: {
    system: 'holographic',
    rot4dXY: 1.2,
    rot4dXZ: -0.65,
    rot4dYZ: 0.48,
    rot4dXW: 0.9,
    rot4dYW: -0.4,
    rot4dZW: 0.35,
    confidence: 0.9,
  }
};

export const PolychoraLayerFocus: Story = {
  args: {
    system: 'polychora',
    rot4dXY: 0.35,
    rot4dXZ: -0.15,
    rot4dYZ: 0.22,
    rot4dXW: 0.4,
    rot4dYW: -0.18,
    rot4dZW: 0.27,
    confidence: 0.88,
  }
};
