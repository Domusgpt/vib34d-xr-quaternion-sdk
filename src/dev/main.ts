import { createQuaternionPreview } from './quaternionPreview.js';

document.addEventListener('DOMContentLoaded', () => {
  const target = document.getElementById('app');
  if (!target) {
    throw new Error('Preview root element not found');
  }

  const params = new URLSearchParams(window.location.search);
  const parseAngle = (key: string, fallback: number) => {
    const raw = Number(params.get(key));
    return Number.isFinite(raw) ? raw : fallback;
  };
  const parseConfidence = (fallback: number) => {
    const raw = Number(params.get('confidence'));
    if (!Number.isFinite(raw)) {
      return fallback;
    }
    return Math.max(0, Math.min(1, raw));
  };

  const initialSystemParam = params.get('system') ?? params.get('engine') ?? undefined;
  const initialPresetId = params.get('preset') ?? undefined;

  createQuaternionPreview(target, {
    heading: params.get('heading') ?? 'XR Localization Quaternion Preview',
    initialAngles: {
      yaw: parseAngle('yaw', 25),
      pitch: parseAngle('pitch', 10),
      roll: parseAngle('roll', -12)
    },
    initialConfidence: parseConfidence(0.9),
    initialSystem: initialSystemParam as string | undefined,
    initialPresetId,
  });
});
