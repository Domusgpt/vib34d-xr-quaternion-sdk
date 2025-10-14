import type { Meta, StoryObj } from '@storybook/html';
import { createQuaternionPreview } from '../dev/quaternionPreview.js';
import '../dev/main.css';

type PreviewArgs = {
  heading: string;
  yaw: number;
  pitch: number;
  roll: number;
  confidence: number;
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
      initialConfidence: args.confidence
    });
    return host;
  },
  argTypes: {
    heading: { control: 'text' },
    yaw: { control: { type: 'range', min: -180, max: 180, step: 1 } },
    pitch: { control: { type: 'range', min: -90, max: 90, step: 1 } },
    roll: { control: { type: 'range', min: -180, max: 180, step: 1 } },
    confidence: { control: { type: 'range', min: 0, max: 1, step: 0.05 } }
  },
  args: {
    heading: 'Storybook Quaternion Preview',
    yaw: 30,
    pitch: 8,
    roll: -14,
    confidence: 0.82
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
