import { createQuaternionPreview } from './quaternionPreview.js';
import { mountWebGPUGlassPreview } from './webgpuGlassPreview.ts';

document.addEventListener('DOMContentLoaded', () => {
  const target = document.getElementById('app');
  if (!target) {
    throw new Error('Preview root element not found');
  }

  const layout = document.createElement('div');
  layout.className = 'dev-panels';
  target.appendChild(layout);

  const quaternionPanel = document.createElement('section');
  quaternionPanel.className = 'dev-panel quaternion-panel';
  layout.appendChild(quaternionPanel);

  createQuaternionPreview(quaternionPanel, {
    heading: 'XR Localization Quaternion Preview',
    initialAngles: { yaw: 25, pitch: 10, roll: -12 },
    initialConfidence: 0.9
  });

  const webgpuPanel = document.createElement('section');
  webgpuPanel.className = 'dev-panel webgpu-preview';
  layout.appendChild(webgpuPanel);

  const webgpuHeading = document.createElement('h2');
  webgpuHeading.textContent = 'WebGPU Glassmorphic Layers';
  webgpuPanel.appendChild(webgpuHeading);

  const canvasWrapper = document.createElement('div');
  canvasWrapper.className = 'webgpu-canvas-wrapper';
  webgpuPanel.appendChild(canvasWrapper);

  const canvas = document.createElement('canvas');
  canvas.className = 'webgpu-preview-canvas';
  canvasWrapper.appendChild(canvas);

  const status = document.createElement('p');
  status.className = 'webgpu-status';
  status.textContent = 'Initializing WebGPU preview…';
  webgpuPanel.appendChild(status);

  mountWebGPUGlassPreview(canvas, {
    onStatus: message => {
      status.textContent = message;
    }
  }).catch(error => {
    console.error('WebGPU preview failed to initialize', error);
    status.textContent = `Initialization failed: ${error instanceof Error ? error.message : String(error)}`;
  });
});
