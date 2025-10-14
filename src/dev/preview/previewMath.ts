import type { AudioBands } from '../../ui/adaptive/renderers/webgpu/WebXRQuaternionBridge.ts';

export function computePreviewTranslation(
  time: number,
  audio: Required<AudioBands>
): [number, number, number] {
  const amplitude = 0.35 + audio.energy * 0.25;
  const x = Math.sin(time * 0.45) * amplitude;
  const y = Math.cos(time * 0.38) * amplitude * 0.45 + (audio.mid - 0.5) * 0.3;
  const z = Math.cos(time * 0.32) * amplitude;
  return [x, y, z];
}

export function computePreviewAnchorPosition(
  stagePosition: readonly [number, number, number]
): [number, number, number] {
  return [
    stagePosition[0] * 0.5,
    stagePosition[1] * 0.4 + 0.18,
    stagePosition[2] * 0.5,
  ];
}
