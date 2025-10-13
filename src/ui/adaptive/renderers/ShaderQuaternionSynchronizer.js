import {
    QuaternionFieldService,
    normalizeQuaternion as normalizeQuaternionUtil,
    quaternionToEuler as quaternionToEulerUtil,
    quaternionToAxisAngle,
    multiplyQuaternions,
    conjugateQuaternion
} from '../../../core/quaternions/QuaternionFieldService.js';

/**
 * ShaderQuaternionSynchronizer
 * ------------------------------------------------------------
 * Bridges normalized spatial quaternions from the SensoryInputBridge into the
 * three primary VIB34D shader systems (faceted, quantum, holographic). The
 * synchronizer listens to spatial anchor, hit-test, and pose channels, derives
 * smoothed motion energy, and applies orientation-driven parameter updates so
 * visual systems react coherently to wearable localization data.
 */

const ROTATION_LIMIT = 6.28; // ±2π rad slider range
const DEG_PER_RAD = 180 / Math.PI;

const PARAM_LIMITS = {
    rot4dXY: { min: -ROTATION_LIMIT, max: ROTATION_LIMIT },
    rot4dXZ: { min: -ROTATION_LIMIT, max: ROTATION_LIMIT },
    rot4dYZ: { min: -ROTATION_LIMIT, max: ROTATION_LIMIT },
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
            quaternionService
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

        this.resolveSystem = typeof systemResolver === 'function'
            ? systemResolver
            : (name => (systems && systems[name]) || null);

        this.enabled = true;
        this.subscriptions = [];
        this.baseParameters = new Map();
        this.lastQuaternion = null;
        this.lastTimestamp = null;
        this.motionEnergy = 0;

        this.quaternionService = quaternionService
            || new QuaternionFieldService({
                energySmoothing: this.energySmoothing,
                velocityReference: this.velocityReference,
                logger: this.logger
            });
        this.quaternionServiceObserver = snapshot => {
            this.applyNormalizedOrientation(snapshot.primaryQuaternion, {
                timestamp: snapshot.timestamp,
                confidence: snapshot.confidence,
                source: snapshot.source,
                position: snapshot.position,
                uniforms: snapshot.uniforms,
                fromQuaternionService: true
            }, snapshot);
        };
        this.quaternionServiceSubscription = null;
        this.subscribeToQuaternionService();
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
        this.subscribeToQuaternionService();
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
        if (this.quaternionServiceSubscription) {
            try {
                this.quaternionServiceSubscription();
            } catch (error) {
                this.logger?.warn?.('[ShaderQuaternionSynchronizer] service unsubscribe failed', error);
            }
            this.quaternionServiceSubscription = null;
        }
    }

    subscribeToQuaternionService() {
        if (!this.quaternionService || this.quaternionServiceSubscription) {
            return;
        }
        try {
            this.quaternionServiceSubscription = this.quaternionService.subscribe(this.quaternionServiceObserver);
        } catch (error) {
            this.logger?.warn?.('[ShaderQuaternionSynchronizer] failed to subscribe to quaternion service', error);
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
                this.applyOrientation(pose.orientation, {
                    confidence,
                    timestamp,
                    source: channel,
                    position: pose.position || null
                });
            }
            return;
        }

        if (channel === 'spatial.hit-tests') {
            const pose = this.extractHitTestPose(event.payload);
            if (pose) {
                const effectiveConfidence = this.normalizeConfidence(pose.confidence ?? confidence);
                this.applyOrientation(pose.orientation, {
                    confidence: effectiveConfidence,
                    timestamp,
                    source: channel,
                    position: pose.position || null
                });
            }
            return;
        }

        if (channel === 'spatial.pose') {
            const orientation = event.payload?.orientation;
            if (orientation) {
                this.applyOrientation(orientation, {
                    confidence,
                    timestamp,
                    source: channel,
                    position: event.payload?.position || null
                });
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
            confidence: best.confidence,
            position: best.pose.position || null
        };
    }

    applyOrientation(quaternion, context = {}) {
        const normalized = this.normalizeQuaternion(quaternion);
        if (!normalized) {
            return;
        }

        if (this.quaternionService && !context.fromQuaternionService) {
            this.quaternionService.ingestPrimaryQuaternion(normalized, context);
            return;
        }

        this.applyNormalizedOrientation(normalized, context);
    }

    applyNormalizedOrientation(normalized, context = {}, derived = {}) {
        const timestamp = typeof derived.timestamp === 'number'
            ? derived.timestamp
            : typeof context.timestamp === 'number'
                ? context.timestamp
                : this.lastTimestamp ?? (typeof performance !== 'undefined' && typeof performance.now === 'function'
                    ? performance.now()
                    : Date.now());
        const confidence = this.normalizeConfidence(
            Number.isFinite(derived.confidence) ? derived.confidence : context.confidence
        );

        const euler = derived.euler || this.quaternionToEuler(normalized);
        const axisAngle = derived.axisAngle || quaternionToAxisAngle(normalized);
        const axis = axisAngle?.axis || { x: 0, y: 0, z: 0 };
        const angle = Number.isFinite(axisAngle?.angle) ? axisAngle.angle : 0;

        const rotationTarget = {
            rot4dXY: this.clampNumber(axis.z * angle * this.rotationScale, PARAM_LIMITS.rot4dXY),
            rot4dXZ: this.clampNumber(-axis.y * angle * this.rotationScale, PARAM_LIMITS.rot4dXZ),
            rot4dYZ: this.clampNumber(axis.x * angle * this.rotationScale, PARAM_LIMITS.rot4dYZ),
            rot4dXW: this.clampNumber(euler.pitch * this.rotationScale, PARAM_LIMITS.rot4dXW),
            rot4dYW: this.clampNumber(euler.yaw * this.rotationScale, PARAM_LIMITS.rot4dYW),
            rot4dZW: this.clampNumber(euler.roll * this.rotationScale, PARAM_LIMITS.rot4dZW)
        };

        let motionEnergy;
        if (Number.isFinite(derived.motionEnergy)) {
            motionEnergy = derived.motionEnergy;
            this.lastQuaternion = normalized;
            this.lastTimestamp = timestamp;
            this.motionEnergy = derived.motionEnergy;
        } else {
            motionEnergy = this.computeMotionEnergy(normalized, timestamp);
        }

        const updateContext = {
            timestamp,
            confidence,
            motionEnergy,
            source: derived.source || context.source || 'quaternion',
            position: derived.position || context.position || null,
            quaternion: normalized,
            euler,
            axisAngle,
            uniforms: derived.uniforms || context.uniforms || null
        };

        this.applyToSystem('quantum', rotationTarget, updateContext);
        this.applyToSystem('holographic', rotationTarget, updateContext);
        this.applyToSystem('faceted', rotationTarget, updateContext);
    }

    applyToSystem(systemName, rotationTarget, context) {
        const system = this.resolveSystem(systemName);
        if (!system) {
            return;
        }

        const updates = {};
        const parameterMeta = {};
        const queueUpdate = (param, targetValue) => {
            const computed = this.computeParameterUpdate(systemName, system, param, targetValue, context);
            if (!computed) {
                return;
            }
            updates[param] = computed.value;
            parameterMeta[param] = {
                current: computed.current,
                target: computed.target,
                alpha: computed.alpha
            };
        };

        queueUpdate('rot4dXY', rotationTarget.rot4dXY);
        queueUpdate('rot4dXZ', rotationTarget.rot4dXZ);
        queueUpdate('rot4dYZ', rotationTarget.rot4dYZ);
        queueUpdate('rot4dXW', rotationTarget.rot4dXW);
        queueUpdate('rot4dYW', rotationTarget.rot4dYW);
        queueUpdate('rot4dZW', rotationTarget.rot4dZW);

        if (systemName === 'quantum') {
            const baseChaos = this.getBaseParameter(systemName, system, 'chaos', 0.2);
            const baseIntensity = this.getBaseParameter(systemName, system, 'intensity', 0.7);
            const chaosTarget = this.clampNumber(baseChaos + (context.motionEnergy || 0) * 0.5, PARAM_LIMITS.chaos);
            const intensityTarget = this.clampNumber(baseIntensity + (context.motionEnergy || 0) * 0.4, PARAM_LIMITS.intensity);
            queueUpdate('chaos', chaosTarget);
            queueUpdate('intensity', intensityTarget);
        } else if (systemName === 'holographic') {
            const baseHue = this.getBaseParameter(systemName, system, 'hue', 320);
            const baseSaturation = this.getBaseParameter(systemName, system, 'saturation', 0.9);
            const hueTarget = this.clampNumber(baseHue + (context.euler?.yaw || 0) * DEG_PER_RAD * 8, PARAM_LIMITS.hue);
            const saturationTarget = this.clampNumber(baseSaturation + (context.motionEnergy || 0) * 0.15, PARAM_LIMITS.saturation);
            queueUpdate('hue', hueTarget);
            queueUpdate('saturation', saturationTarget);
        } else if (systemName === 'faceted') {
            const baseSpeed = this.getBaseParameter(systemName, system, 'speed', 1);
            const speedTarget = this.clampNumber(baseSpeed + (context.motionEnergy || 0) * 0.6, PARAM_LIMITS.speed);
            queueUpdate('speed', speedTarget);
        }

        if (!Object.keys(updates).length) {
            return;
        }

        const contextForSystem = {
            ...context,
            systemName,
            parameters: parameterMeta
        };

        if (typeof system.batchUpdate === 'function') {
            try {
                system.batchUpdate(updates, contextForSystem);
                return;
            } catch (error) {
                this.logger?.warn?.('[ShaderQuaternionSynchronizer] batchUpdate failed, falling back to single updates', { systemName, error });
            }
        }

        for (const [param, value] of Object.entries(updates)) {
            this.invokeUpdateParameter(systemName, system, param, value, contextForSystem);
        }
    }

    computeParameterUpdate(systemName, system, param, targetValue, context = {}) {
        const limits = PARAM_LIMITS[param];
        const sanitizedTarget = limits ? this.clampNumber(targetValue, limits) : targetValue;
        if (!Number.isFinite(sanitizedTarget)) {
            return null;
        }

        const current = this.getCurrentParameter(system, param);
        const alpha = this.computeAlpha(context.confidence);
        const nextValue = this.lerp(current, sanitizedTarget, alpha);

        if (!Number.isFinite(nextValue)) {
            return null;
        }

        if (Math.abs(nextValue - current) < 1e-6) {
            return null;
        }

        return { value: nextValue, target: sanitizedTarget, current, alpha };
    }

    invokeUpdateParameter(systemName, system, param, value, context) {
        if (!Number.isFinite(value)) {
            return;
        }

        try {
            if (typeof system.updateParameter === 'function') {
                system.updateParameter(param, value, context);
                return;
            }

            if (system.parameters instanceof Map) {
                system.parameters.set(param, value);
                return;
            }

            if (system.parameters && typeof system.parameters === 'object') {
                system.parameters[param] = value;
            }
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

    normalizeQuaternion(quaternion) {
        return normalizeQuaternionUtil(quaternion);
    }

    quaternionToEuler(q) {
        return quaternionToEulerUtil(q);
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

        const deltaQuat = multiplyQuaternions(quaternion, conjugateQuaternion(this.lastQuaternion));
        const angle = 2 * Math.atan2(
            Math.hypot(deltaQuat.x, deltaQuat.y, deltaQuat.z),
            deltaQuat.w
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
