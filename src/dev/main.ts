import { createQuaternionPreview } from './quaternionPreview.js';

document.addEventListener('DOMContentLoaded', () => {
  const target = document.getElementById('app');
  if (!target) {
    throw new Error('Preview root element not found');
  }

  createQuaternionPreview(target, {
    heading: 'XR Localization Quaternion Preview',
    initialAngles: { yaw: 25, pitch: 10, roll: -12 },
    initialConfidence: 0.9
  });
});
