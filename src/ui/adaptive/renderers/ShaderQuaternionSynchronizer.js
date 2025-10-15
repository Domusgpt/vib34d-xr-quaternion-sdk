/**
 * ShaderQuaternionSynchronizer
 * ------------------------------------------------------------
 * Bridges normalized spatial quaternions from the SensoryInputBridge into the
 * three primary VIB34D shader systems (faceted, quantum, holographic). The
 * synchronizer listens to spatial anchor, hit-test, and pose channels, derives
 * smoothed motion energy, and applies orientation-driven parameter updates so
 * visual systems react coherently to wearable localization data.
 */

import {
    IDENTITY_QUATERNION,
    conjugate as conjugateQuaternion,
    multiply as multiplyQuaternion,
    normalize as normalizeQuaternionTuple
} from '../../../core/quaternion/index.ts';

const ROTATION_LIMIT = 6.28; // ±2π rad slider range
const DEG_PER_RAD = 180 / Math.PI;

const PARAM_LIMITS = {
    rot4dXW: { min: -ROTATION_LIMIT, max: ROTATION_LIMIT },
    rot4dYW: { min: -ROTATION_LIMIT, max: ROTATION_LIMIT },
    rot4dZW: { min: -ROTATION_LIMIT, max: ROTATION_LIMIT },
    chaos: { min: 0, max: 1 },
    intensity: { min: 0, max: 1 },
    speed: { min: 0.1, max: 4 },
    saturation: { min: 0, max: 1 },
    hue: { min: 0, max: 360 }
};

const CHANNELS = ['spatial.anchors', 'spatial.hit-tests', 'spatial.pose'];
const DEFAULT_SYSTEMS = ['quantum', 'holographic', 'faceted'];

const identityQuaternionTuple = () => IDENTITY_QUATERNION;

const toQuaternionTuple = quaternion => {
    if (!quaternion || typeof quaternion !== 'object') {
        return identityQuaternionTuple();
    }

    const x = Number(quaternion.x) || 0;
    const y = Number(quaternion.y) || 0;
    const z = Number(quaternion.z) || 0;
    const w = Number(quaternion.w);
    const inferredW = Number.isFinite(w) ? w : Math.sqrt(Math.max(0, 1 - (x * x + y * y + z * z)));

    return [x, y, z, inferredW];
};

export class ShaderQuaternionSynchronizer {
    constructor(options = {}) {
        const {
            bridge,
            systems,
            systemResolver,
            rotationScale = 2,
            minConfidence = 0.45,
            baseAlpha = 0.25,
            energySmoothing = 0.35,
            velocityReference = 8,
            logger = console,
            targetSystems,
            autoExclusiveActivation = true,
            activationEventTarget = typeof window !== 'undefined' ? window : null,
            activationEvent = 'vib34d:system-activated',
            deactivationEvent = 'vib34d:system-deactivated'
        } = options;

        if (!bridge || typeof bridge.subscribe !== 'function') {
            throw new Error('ShaderQuaternionSynchronizer requires a SensoryInputBridge instance');
        }

        this.bridge = bridge;
        this.rotationScale = rotationScale;
        this.minConfidence = minConfidence;
        this.baseAlpha = baseAlpha;
        this.energySmoothing = Math.max(0, Math.min(1, energySmoothing));
        this.velocityReference = Math.max(0.001, velocityReference);
        this.logger = logger;

        this.targetSystems = new Set();
        const inferredTargets = Array.isArray(targetSystems) && targetSystems.length > 0
            ? targetSystems
            : systems && typeof systems === 'object'
                ? Object.keys(systems)
                : DEFAULT_SYSTEMS;
        this.setTargetSystems(inferredTargets);

        this.activationEventTarget = activationEventTarget;
        this.activationEvent = activationEvent;
        this.deactivationEvent = deactivationEvent;
        this.autoExclusiveActivation = !!autoExclusiveActivation;
        this.activationListener = null;
        this.deactivationListener = null;

        if (this.autoExclusiveActivation && this.activationEventTarget?.addEventListener) {
            this.activationListener = event => {
                const detail = event?.detail || {};
                const detailTargets = Array.isArray(detail?.systems) ? detail.systems : null;
                if (detailTargets && detailTargets.length > 0) {
                    this.setTargetSystems(detailTargets);
                    return;
                }
                const systemName = typeof detail?.systemName === 'string' ? detail.systemName.trim() : '';
                if (systemName) {
                    this.activateExclusiveSystem(systemName);
                }
            };

            this.deactivationListener = event => {
                const detail = event?.detail || {};
                const systemName = typeof detail?.systemName === 'string' ? detail.systemName.trim() : '';
                if (!systemName) {
                    return;
                }
                if (this.targetSystems.has(systemName)) {
                    const remaining = [...this.targetSystems].filter(name => name !== systemName);
                    this.setTargetSystems(remaining);
                }
            };

            this.activationEventTarget.addEventListener(this.activationEvent, this.activationListener);
            this.activationEventTarget.addEventListener(this.deactivationEvent, this.deactivationListener);
        }

        this.resolveSystem = typeof systemResolver === 'function'
            ? systemResolver
            : (name => (systems && systems[name]) || null);

        this.enabled = true;
        this.subscriptions = [];
        this.baseParameters = new Map();
        this.lastQuaternion = null;
        this.lastTimestamp = null;
        this.motionEnergy = 0;
    }

    start() {
        this.stop();
        CHANNELS.forEach(channel => {
            const unsubscribe = this.bridge.subscribe(channel, event => {
                try {
                    this.handleEvent(channel, event || {});
                } catch (error) {
                    this.logger?.warn?.('[ShaderQuaternionSynchronizer] channel handler failed', { channel, error });
                }
            });
            this.subscriptions.push(unsubscribe);
        });
        return this;
    }

    stop() {
        while (this.subscriptions.length > 0) {
            try {
                this.subscriptions.pop()?.();
            } catch (error) {
                this.logger?.warn?.('[ShaderQuaternionSynchronizer] unsubscribe failed', error);
            }
        }
    }

    setEnabled(enabled) {
        this.enabled = !!enabled;
    }

    handleEvent(channel, event) {
        if (!this.enabled) {
            return;
        }
        const confidence = this.normalizeConfidence(event.confidence);
        const timestamp = typeof event.timestamp === 'number' ? event.timestamp : performance?.now?.() || Date.now();

        if (channel === 'spatial.anchors') {
            const pose = this.extractAnchorPose(event.payload);
            if (pose) {
                this.applyOrientation(pose.orientation, { confidence, timestamp, source: channel });
            }
            return;
        }

        if (channel === 'spatial.hit-tests') {
            const pose = this.extractHitTestPose(event.payload);
            if (pose) {
                const effectiveConfidence = this.normalizeConfidence(pose.confidence ?? confidence);
                this.applyOrientation(pose.orientation, { confidence: effectiveConfidence, timestamp, source: channel });
            }
            return;
        }

        if (channel === 'spatial.pose') {
            const orientation = event.payload?.orientation;
            if (orientation) {
                this.applyOrientation(orientation, { confidence, timestamp, source: channel });
            }
        }
    }

    extractAnchorPose(payload) {
        const anchors = payload?.anchors;
        if (!Array.isArray(anchors) || anchors.length === 0) {
            return null;
        }

        let best = anchors[0];
        let bestConfidence = typeof best?.confidence === 'number' ? best.confidence : -1;
        for (const anchor of anchors) {
            const confidence = typeof anchor?.confidence === 'number' ? anchor.confidence : -1;
            if (confidence > bestConfidence) {
                best = anchor;
                bestConfidence = confidence;
            }
        }
        return best?.pose || null;
    }

    extractHitTestPose(payload) {
        const results = payload?.results;
        if (!Array.isArray(results) || results.length === 0) {
            return null;
        }

        let best = null;
        let bestScore = -Infinity;
        for (const result of results) {
            const confidence = typeof result?.confidence === 'number' ? result.confidence : 0.5;
            const distance = typeof result?.distance === 'number' ? result.distance : 0;
            const score = confidence - distance * 0.01; // prefer confident, close hits
            if (score > bestScore) {
                bestScore = score;
                best = result;
            }
        }
        if (!best?.pose) {
            return null;
        }
        return {
            orientation: best.pose.orientation,
            confidence: best.confidence
        };
    }

    applyOrientation(quaternion, context = {}) {
        const normalized = this.normalizeQuaternion(quaternion);
        const timestamp = typeof context.timestamp === 'number' ? context.timestamp : this.lastTimestamp || 0;
        const confidence = this.normalizeConfidence(context.confidence);

        if (!normalized) {
            return;
        }

        const euler = this.quaternionToEuler(normalized);
        const rotationTarget = {
            rot4dXW: this.clampNumber(euler.pitch * this.rotationScale, PARAM_LIMITS.rot4dXW),
            rot4dYW: this.clampNumber(euler.yaw * this.rotationScale, PARAM_LIMITS.rot4dYW),
            rot4dZW: this.clampNumber(euler.roll * this.rotationScale, PARAM_LIMITS.rot4dZW)
        };

        const motionEnergy = this.computeMotionEnergy(normalized, timestamp);
        if (this.targetSystems.size === 0) {
            return;
        }

        for (const systemName of this.targetSystems) {
            this.applyToSystem(systemName, rotationTarget, motionEnergy, confidence, euler);
        }
    }

    applyToSystem(systemName, rotationTarget, motionEnergy, confidence, euler) {
        const system = this.resolveSystem(systemName);
        if (!system || typeof system.updateParameter !== 'function') {
            return;
        }

        this.applyParameter(systemName, system, 'rot4dXW', rotationTarget.rot4dXW, confidence);
        this.applyParameter(systemName, system, 'rot4dYW', rotationTarget.rot4dYW, confidence);
        this.applyParameter(systemName, system, 'rot4dZW', rotationTarget.rot4dZW, confidence);

        if (systemName === 'quantum') {
            const baseChaos = this.getBaseParameter(systemName, system, 'chaos', 0.2);
            const baseIntensity = this.getBaseParameter(systemName, system, 'intensity', 0.7);
            const chaosTarget = this.clampNumber(baseChaos + motionEnergy * 0.5, PARAM_LIMITS.chaos);
            const intensityTarget = this.clampNumber(baseIntensity + motionEnergy * 0.4, PARAM_LIMITS.intensity);
            this.applyParameter(systemName, system, 'chaos', chaosTarget, confidence);
            this.applyParameter(systemName, system, 'intensity', intensityTarget, confidence);
        } else if (systemName === 'holographic') {
            const baseHue = this.getBaseParameter(systemName, system, 'hue', 320);
            const baseSaturation = this.getBaseParameter(systemName, system, 'saturation', 0.9);
            const hueTarget = this.clampNumber(baseHue + euler.yaw * DEG_PER_RAD * 8, PARAM_LIMITS.hue);
            const saturationTarget = this.clampNumber(baseSaturation + motionEnergy * 0.15, PARAM_LIMITS.saturation);
            this.applyParameter(systemName, system, 'hue', hueTarget, confidence);
            this.applyParameter(systemName, system, 'saturation', saturationTarget, confidence);
        } else if (systemName === 'faceted') {
            const baseSpeed = this.getBaseParameter(systemName, system, 'speed', 1);
            const speedTarget = this.clampNumber(baseSpeed + motionEnergy * 0.6, PARAM_LIMITS.speed);
            this.applyParameter(systemName, system, 'speed', speedTarget, confidence);
        }
    }

    applyParameter(systemName, system, param, targetValue, confidence) {
        const limits = PARAM_LIMITS[param];
        const sanitizedTarget = limits ? this.clampNumber(targetValue, limits) : targetValue;
        const current = this.getCurrentParameter(system, param);
        const alpha = this.computeAlpha(confidence);
        const nextValue = this.lerp(current, sanitizedTarget, alpha);

        if (!Number.isFinite(nextValue)) {
            return;
        }

        try {
            system.updateParameter(param, nextValue);
        } catch (error) {
            this.logger?.warn?.('[ShaderQuaternionSynchronizer] failed to update parameter', { systemName, param, error });
        }
    }

    getCurrentParameter(system, param) {
        if (!system) return 0;
        if (typeof system.getParameter === 'function') {
            const value = system.getParameter(param);
            return Number.isFinite(value) ? value : 0;
        }
        if (system.parameters instanceof Map && system.parameters.has(param)) {
            const value = Number(system.parameters.get(param));
            return Number.isFinite(value) ? value : 0;
        }
        if (system.parameters && typeof system.parameters[param] !== 'undefined') {
            const value = Number(system.parameters[param]);
            return Number.isFinite(value) ? value : 0;
        }
        return 0;
    }

    getBaseParameter(systemName, system, param, fallback) {
        if (!this.baseParameters.has(systemName)) {
            this.baseParameters.set(systemName, new Map());
        }
        const map = this.baseParameters.get(systemName);
        if (!map.has(param)) {
            const value = this.getCurrentParameter(system, param);
            map.set(param, Number.isFinite(value) ? value : fallback);
        }
        return map.get(param);
    }

    setTargetSystems(systemNames) {
        const names = Array.isArray(systemNames) ? systemNames : [];
        const sanitized = names
            .map(name => (typeof name === 'string' ? name.trim() : ''))
            .filter(name => name.length > 0);
        this.targetSystems = new Set(sanitized);
        return this;
    }

    activateExclusiveSystem(systemName) {
        if (typeof systemName !== 'string' || !systemName.trim()) {
            this.targetSystems.clear();
            return this;
        }
        this.setTargetSystems([systemName.trim()]);
        return this;
    }

    getTargetSystems() {
        return [...this.targetSystems];
    }

    destroy() {
        this.stop();
        if (this.activationListener && this.activationEventTarget?.removeEventListener) {
            this.activationEventTarget.removeEventListener(this.activationEvent, this.activationListener);
        }
        if (this.deactivationListener && this.activationEventTarget?.removeEventListener) {
            this.activationEventTarget.removeEventListener(this.deactivationEvent, this.deactivationListener);
        }
        this.activationListener = null;
        this.deactivationListener = null;
    }

    normalizeQuaternion(quaternion) {
        const tuple = toQuaternionTuple(quaternion);
        const normalized = normalizeQuaternionTuple(tuple);
        if (!normalized) {
            return identityQuaternionTuple();
        }
        return normalized;
    }

    quaternionToEuler(q) {
        const [x, y, z, w] = q;

        // Roll (x-axis rotation)
        const sinr = 2 * (w * x + y * z);
        const cosr = 1 - 2 * (x * x + y * y);
        const roll = Math.atan2(sinr, cosr);

        // Pitch (y-axis rotation)
        const sinp = 2 * (w * y - z * x);
        const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);

        // Yaw (z-axis rotation)
        const siny = 2 * (w * z + x * y);
        const cosy = 1 - 2 * (y * y + z * z);
        const yaw = Math.atan2(siny, cosy);

        return { roll, pitch, yaw };
    }

    normalizeConfidence(value) {
        if (!Number.isFinite(value)) {
            return this.baseAlpha;
        }
        return Math.max(0, Math.min(1, value));
    }

    computeAlpha(confidence) {
        if (!Number.isFinite(confidence)) {
            return this.baseAlpha;
        }
        if (confidence <= 0) {
            return this.baseAlpha * 0.5;
        }
        if (confidence < this.minConfidence) {
            return this.baseAlpha * (confidence / this.minConfidence);
        }
        return Math.max(this.baseAlpha, Math.min(1, confidence));
    }

    computeMotionEnergy(quaternion, timestamp) {
        if (!this.lastQuaternion) {
            this.lastQuaternion = quaternion;
            this.lastTimestamp = timestamp;
            this.motionEnergy = 0;
            return 0;
        }

        const deltaQuat = multiplyQuaternion(quaternion, conjugateQuaternion(this.lastQuaternion));
        const angle = 2 * Math.atan2(
            Math.hypot(deltaQuat[0], deltaQuat[1], deltaQuat[2]),
            deltaQuat[3]
        );

        const lastTime = typeof this.lastTimestamp === 'number' ? this.lastTimestamp : timestamp;
        const deltaTimeSeconds = Math.max(0.001, (timestamp - lastTime) / 1000);
        const angularVelocity = Math.abs(angle) / deltaTimeSeconds;
        const instantaneousEnergy = Math.min(1, angularVelocity / this.velocityReference);

        this.motionEnergy = this.lerp(this.motionEnergy, instantaneousEnergy, this.energySmoothing);
        this.lastQuaternion = quaternion;
        this.lastTimestamp = timestamp;
        return this.motionEnergy;
    }

    lerp(start, end, alpha) {
        return start + (end - start) * alpha;
    }

    clampNumber(value, limits) {
        if (!limits) return value;
        const min = typeof limits.min === 'number' ? limits.min : -Infinity;
        const max = typeof limits.max === 'number' ? limits.max : Infinity;
        const number = Number(value);
        if (!Number.isFinite(number)) {
            return min;
        }
        return Math.max(min, Math.min(max, number));
    }
}

export default ShaderQuaternionSynchronizer;
