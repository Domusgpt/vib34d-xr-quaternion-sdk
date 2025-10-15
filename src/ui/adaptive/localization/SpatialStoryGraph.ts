import { extractTranslation } from '../../../core/quaternion/index.ts';
import type { LocalizationSnapshot } from './LocalizationBridge.ts';
import type { FabricChannelState } from './QuaternionFabricRouter.ts';
import type { RotorFusionState } from './RotorFusionService.ts';
import type { PredictiveRotorState } from './PredictiveRotorCache.ts';
import type { AudioBands, VisualParameterVector } from '../renderers/webgpu/WebXRQuaternionBridge.ts';

export interface StoryNode {
  readonly id: string;
  readonly label: string;
  readonly type: 'stage' | 'anchor' | 'story' | string;
  readonly position?: readonly [number, number, number];
  readonly radius?: number;
  readonly metadata?: Record<string, unknown>;
}

export interface StoryNodeState extends StoryNode {
  readonly lastUpdated: number;
  readonly confidence?: number;
  readonly drift?: number;
}

export interface StoryTriggerActivation {
  readonly pluginId: string;
  readonly label: string;
  readonly intensity: number;
  readonly nodeId?: string;
  readonly details?: Record<string, unknown>;
}

export interface StoryEffect {
  readonly pulse?: number;
  readonly audioBoost?: Partial<Required<AudioBands>>;
  readonly visualAdjust?: Partial<Required<VisualParameterVector>>;
  readonly confidenceNudge?: number;
  readonly activations?: StoryTriggerActivation[];
}

export interface StoryGraphEvaluationContext {
  readonly frameTime: number;
  readonly deltaTime: number;
  readonly snapshot?: LocalizationSnapshot | null;
  readonly channel?: FabricChannelState | null;
  readonly fusion?: RotorFusionState | null;
  readonly prediction?: PredictiveRotorState | null;
  readonly audio: Required<AudioBands>;
  readonly visual: Required<VisualParameterVector>;
  readonly confidence: number;
}

export interface StoryGraphPluginContext extends StoryGraphEvaluationContext {
  readonly nodes: ReadonlyMap<string, StoryNodeState>;
}

export interface StoryGraphPlugin {
  readonly id: string;
  readonly label?: string;
  evaluate(context: StoryGraphPluginContext): StoryEffect | null;
}

export interface SpatialStoryGraphOptions {
  readonly plugins?: StoryGraphPlugin[];
  readonly autoRegisterDefaults?: boolean;
  readonly logger?: { warn?: (...args: unknown[]) => void };
}

export interface StoryGraphUpdateResult extends StoryEffect {
  readonly nodes: StoryNodeState[];
}

const clamp01 = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

function mergeEffects(base: StoryEffect, incoming: StoryEffect | null | undefined): StoryEffect {
  if (!incoming) {
    return base;
  }

  const result: StoryEffect = {
    pulse: Math.max(base.pulse ?? 0, incoming.pulse ?? 0),
    confidenceNudge: (base.confidenceNudge ?? 0) + (incoming.confidenceNudge ?? 0),
    activations: [...(base.activations ?? []), ...(incoming.activations ?? [])],
    audioBoost: base.audioBoost ? { ...base.audioBoost } : undefined,
    visualAdjust: base.visualAdjust ? { ...base.visualAdjust } : undefined,
  };

  if (incoming.audioBoost) {
    result.audioBoost = result.audioBoost ?? {};
    for (const key of Object.keys(incoming.audioBoost) as (keyof Required<AudioBands>)[]) {
      const value = incoming.audioBoost[key];
      if (value != null) {
        result.audioBoost[key] = (result.audioBoost[key] ?? 0) + value;
      }
    }
  }

  if (incoming.visualAdjust) {
    result.visualAdjust = result.visualAdjust ?? {};
    for (const key of Object.keys(incoming.visualAdjust) as (keyof Required<VisualParameterVector>)[]) {
      const value = incoming.visualAdjust[key];
      if (value != null) {
        result.visualAdjust[key] = (result.visualAdjust[key] ?? 0) + value;
      }
    }
  }

  return result;
}

class ConfidenceDipPlugin implements StoryGraphPlugin {
  readonly id = 'confidence-dip';
  readonly label = 'Confidence Dip Response';
  private lastConfidence = 1;

  evaluate(context: StoryGraphPluginContext): StoryEffect | null {
    const delta = context.confidence - this.lastConfidence;
    this.lastConfidence = context.confidence;

    if (context.confidence < 0.55 && delta < -0.02) {
      const intensity = clamp01((0.55 - context.confidence) * 1.6);
      return {
        pulse: intensity,
        audioBoost: { energy: intensity * 0.5, mid: intensity * 0.3 },
        confidenceNudge: intensity * 0.1,
        activations: [
          {
            pluginId: this.id,
            label: 'Stabilize when confidence dips',
            intensity,
          },
        ],
      };
    }

    return null;
  }
}

class DriftExcursionPlugin implements StoryGraphPlugin {
  readonly id = 'drift-excursion';
  readonly label = 'Drift Excursion Cue';
  private lastDrift = 0;

  evaluate(context: StoryGraphPluginContext): StoryEffect | null {
    const drift = clamp01(context.channel?.current?.drift ?? context.fusion?.drift ?? 0);
    const delta = drift - this.lastDrift;
    this.lastDrift = drift;

    if (drift > 0.35 && delta > 0.01) {
      const intensity = clamp01((drift - 0.35) * 1.2);
      return {
        visualAdjust: { morphFactor: intensity * 0.4, rotationSpeed: intensity * 0.3 },
        audioBoost: { high: intensity * 0.35 },
        activations: [
          {
            pluginId: this.id,
            label: 'Localization drift spike',
            intensity,
            details: { drift },
          },
        ],
      };
    }

    return null;
  }
}

class AudioSurgePlugin implements StoryGraphPlugin {
  readonly id = 'audio-surge';
  readonly label = 'Audio Surge Sequencer';
  private lastEnergy = 0;

  evaluate(context: StoryGraphPluginContext): StoryEffect | null {
    const energy = clamp01(context.audio.energy);
    const delta = energy - this.lastEnergy;
    this.lastEnergy = energy;

    if (energy > 0.75 && delta > 0.05) {
      const intensity = clamp01((energy - 0.7) * 1.5);
      return {
        pulse: intensity * 0.85,
        visualAdjust: { dimension: intensity * 0.6, universeModifier: intensity * 0.4 },
        activations: [
          {
            pluginId: this.id,
            label: 'Audio energy surge',
            intensity,
            details: { energy },
          },
        ],
      };
    }

    return null;
  }
}

export class SpatialStoryGraph {
  private readonly nodes = new Map<string, StoryNodeState>();
  private readonly plugins: StoryGraphPlugin[] = [];
  private readonly logger?: { warn?: (...args: unknown[]) => void };
  private lastResult: StoryGraphUpdateResult | null = null;

  constructor(options: SpatialStoryGraphOptions = {}) {
    this.logger = options.logger;
    if (options.plugins) {
      options.plugins.forEach(plugin => this.registerPlugin(plugin));
    }
    if (options.autoRegisterDefaults !== false) {
      this.registerPlugin(new ConfidenceDipPlugin());
      this.registerPlugin(new DriftExcursionPlugin());
      this.registerPlugin(new AudioSurgePlugin());
    }
  }

  registerNode(node: StoryNode): void {
    const now = typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
    const state: StoryNodeState = {
      ...node,
      lastUpdated: now,
      confidence: node.metadata?.confidence as number | undefined,
      drift: node.metadata?.drift as number | undefined,
    };
    this.nodes.set(node.id, state);
  }

  registerPlugin(plugin: StoryGraphPlugin): void {
    if (!this.plugins.some(existing => existing.id === plugin.id)) {
      this.plugins.push(plugin);
    }
  }

  clearNodes(): void {
    this.nodes.clear();
  }

  update(context: StoryGraphEvaluationContext): StoryGraphUpdateResult {
    this.updateBuiltInNodes(context);

    let accumulated: StoryEffect = { activations: [] };
    for (const plugin of this.plugins) {
      try {
        const effect = plugin.evaluate({
          ...context,
          nodes: this.nodes,
        });
        accumulated = mergeEffects(accumulated, effect);
      } catch (error) {
        this.logger?.warn?.(`[SpatialStoryGraph] Plugin ${plugin.id} failed`, error);
      }
    }

    const normalized: StoryGraphUpdateResult = {
      pulse: accumulated.pulse,
      confidenceNudge: accumulated.confidenceNudge,
      audioBoost: accumulated.audioBoost,
      visualAdjust: accumulated.visualAdjust,
      activations: accumulated.activations ?? [],
      nodes: Array.from(this.nodes.values()),
    };

    this.lastResult = normalized;
    return normalized;
  }

  getLastResult(): StoryGraphUpdateResult | null {
    return this.lastResult;
  }

  listActivations(): StoryTriggerActivation[] {
    return [...(this.lastResult?.activations ?? [])];
  }

  private updateBuiltInNodes(context: StoryGraphEvaluationContext): void {
    const now = context.frameTime;
    const stage = context.snapshot;
    if (stage && stage.local) {
      const translation = extractTranslation(stage.local);
      const node: StoryNodeState = {
        id: 'stage',
        label: 'Stage Space',
        type: 'stage',
        position: [translation[0], translation[1], translation[2]],
        lastUpdated: now,
        confidence: stage.stageConfidence,
        drift: stage.drift,
      };
      this.nodes.set(node.id, node);
    }

    const anchor = context.snapshot?.provenance?.anchorId;
    if (anchor) {
      const existing = this.nodes.get(`anchor:${anchor}`);
      const node: StoryNodeState = {
        id: `anchor:${anchor}`,
        label: `Anchor ${anchor}`,
        type: 'anchor',
        position: existing?.position,
        lastUpdated: now,
        confidence: context.snapshot?.anchorConfidence,
        drift: context.snapshot?.drift,
      };
      this.nodes.set(node.id, node);
    }

    if (context.prediction) {
      const node: StoryNodeState = {
        id: 'prediction',
        label: 'Predicted Rotor',
        type: 'story',
        position: [
          context.prediction.rotor[0],
          context.prediction.rotor[1],
          context.prediction.rotor[2],
        ],
        lastUpdated: now,
        confidence: context.prediction.confidence,
        drift: context.prediction.latency,
      };
      this.nodes.set(node.id, node);
    }
  }
}

export default SpatialStoryGraph;
