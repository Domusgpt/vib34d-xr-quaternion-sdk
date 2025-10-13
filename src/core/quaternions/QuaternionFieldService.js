const clamp01 = value => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));

export const IDENTITY_QUATERNION = Object.freeze({ x: 0, y: 0, z: 0, w: 1 });

export function createIdentityQuaternion() {
    return { ...IDENTITY_QUATERNION };
}

export function normalizeQuaternion(quaternion) {
    if (!quaternion || typeof quaternion !== 'object') {
        return createIdentityQuaternion();
    }

    const x = Number(quaternion.x) || 0;
    const y = Number(quaternion.y) || 0;
    const z = Number(quaternion.z) || 0;
    const wInput = Number(quaternion.w);
    const w = Number.isFinite(wInput) ? wInput : Math.sqrt(Math.max(0, 1 - (x * x + y * y + z * z)));
    const length = Math.hypot(x, y, z, w);

    if (length === 0) {
        return createIdentityQuaternion();
    }

    return {
        x: x / length,
        y: y / length,
        z: z / length,
        w: w / length
    };
}

export function quaternionToEuler(q) {
    const sinr = 2 * (q.w * q.x + q.y * q.z);
    const cosr = 1 - 2 * (q.x * q.x + q.y * q.y);
    const roll = Math.atan2(sinr, cosr);

    const sinp = 2 * (q.w * q.y - q.z * q.x);
    const pitch = Math.abs(sinp) >= 1 ? Math.sign(sinp) * (Math.PI / 2) : Math.asin(sinp);

    const siny = 2 * (q.w * q.z + q.x * q.y);
    const cosy = 1 - 2 * (q.y * q.y + q.z * q.z);
    const yaw = Math.atan2(siny, cosy);

    return { roll, pitch, yaw };
}

export function multiplyQuaternions(a, b) {
    return {
        w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
        x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
        y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
        z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w
    };
}

export function conjugateQuaternion(q) {
    return { x: -q.x, y: -q.y, z: -q.z, w: q.w };
}

function toFloatArray(quaternion) {
    return new Float32Array([quaternion.x, quaternion.y, quaternion.z, quaternion.w]);
}

function resolveTimestamp(candidate) {
    if (typeof candidate === 'number') {
        return candidate;
    }
    if (typeof performance !== 'undefined' && typeof performance.now === 'function') {
        return performance.now();
    }
    return Date.now();
}

export class QuaternionFieldService {
    constructor(options = {}) {
        const {
            energySmoothing = 0.35,
            velocityReference = 8,
            logger = console
        } = options;

        this.logger = logger;
        this.energySmoothing = clamp01(energySmoothing);
        this.velocityReference = Math.max(0.001, Number.isFinite(velocityReference) ? velocityReference : 8);

        this.state = {
            primary: createIdentityQuaternion(),
            secondary: createIdentityQuaternion(),
            position: { x: 0, y: 0, z: 0 },
            timestamp: 0,
            confidence: 1,
            motionEnergy: 0,
            source: 'init'
        };

        this.observers = new Set();
        this.lastPrimary = this.state.primary;
        this.lastTimestamp = 0;
    }

    subscribe(handler) {
        if (typeof handler !== 'function') {
            throw new TypeError('QuaternionFieldService.subscribe requires a function handler');
        }
        this.observers.add(handler);
        handler(this.createSnapshot());
        return () => this.observers.delete(handler);
    }

    ingestPrimaryQuaternion(quaternion, metadata = {}) {
        const normalized = normalizeQuaternion(quaternion);
        const timestamp = resolveTimestamp(metadata.timestamp);
        const confidence = this.normalizeConfidence(metadata.confidence);
        const motionEnergy = this.computeMotionEnergy(normalized, timestamp);

        this.state = {
            ...this.state,
            primary: normalized,
            timestamp,
            confidence,
            motionEnergy,
            source: metadata.source || 'primary'
        };

        this.emit();
    }

    ingestSecondaryQuaternion(quaternion, metadata = {}) {
        const normalized = normalizeQuaternion(quaternion);
        this.state = {
            ...this.state,
            secondary: normalized,
            source: metadata.source || 'secondary'
        };
        this.emit();
    }

    ingestPose(pose = {}, metadata = {}) {
        const updates = {};
        let shouldEmit = false;

        if (pose.orientation) {
            const normalizedPrimary = normalizeQuaternion(pose.orientation);
            const timestamp = resolveTimestamp(metadata.timestamp ?? pose.timestamp);
            const confidence = this.normalizeConfidence(metadata.confidence ?? pose.confidence);
            const motionEnergy = this.computeMotionEnergy(normalizedPrimary, timestamp);

            updates.primary = normalizedPrimary;
            updates.timestamp = timestamp;
            updates.confidence = confidence;
            updates.motionEnergy = motionEnergy;
            shouldEmit = true;
        }

        if (pose.secondaryOrientation) {
            updates.secondary = normalizeQuaternion(pose.secondaryOrientation);
            shouldEmit = true;
        }

        if (pose.position && typeof pose.position === 'object') {
            updates.position = {
                x: Number(pose.position.x) || 0,
                y: Number(pose.position.y) || 0,
                z: Number(pose.position.z) || 0
            };
            shouldEmit = true;
        }

        if (!shouldEmit) {
            return;
        }

        this.state = {
            ...this.state,
            ...updates,
            source: metadata.source || pose.source || 'pose'
        };

        this.emit();
    }

    createSnapshot() {
        return {
            primaryQuaternion: this.state.primary,
            secondaryQuaternion: this.state.secondary,
            position: this.state.position,
            timestamp: this.state.timestamp,
            confidence: this.state.confidence,
            motionEnergy: this.state.motionEnergy,
            source: this.state.source,
            euler: quaternionToEuler(this.state.primary),
            uniforms: {
                left: toFloatArray(this.state.primary),
                right: toFloatArray(this.state.secondary),
                dual: new Float32Array([
                    this.state.primary.x,
                    this.state.primary.y,
                    this.state.primary.z,
                    this.state.primary.w,
                    this.state.secondary.x,
                    this.state.secondary.y,
                    this.state.secondary.z,
                    this.state.secondary.w
                ])
            }
        };
    }

    emit() {
        const snapshot = this.createSnapshot();
        for (const observer of this.observers) {
            try {
                observer(snapshot);
            } catch (error) {
                this.logger?.warn?.('[QuaternionFieldService] observer failed', error);
            }
        }
    }

    normalizeConfidence(value) {
        if (!Number.isFinite(value)) {
            return this.state.confidence;
        }
        return clamp01(value);
    }

    computeMotionEnergy(quaternion, timestamp) {
        if (!this.lastPrimary) {
            this.lastPrimary = quaternion;
            this.lastTimestamp = timestamp;
            this.state.motionEnergy = 0;
            return 0;
        }

        const delta = multiplyQuaternions(quaternion, conjugateQuaternion(this.lastPrimary));
        const angle = 2 * Math.atan2(
            Math.hypot(delta.x, delta.y, delta.z),
            delta.w
        );

        const deltaTimeSeconds = Math.max(0.001, (timestamp - this.lastTimestamp) / 1000);
        const angularVelocity = Math.abs(angle) / deltaTimeSeconds;
        const instantaneousEnergy = Math.min(1, angularVelocity / this.velocityReference);

        const smoothed = this.state.motionEnergy + (instantaneousEnergy - this.state.motionEnergy) * this.energySmoothing;

        this.lastPrimary = quaternion;
        this.lastTimestamp = timestamp;
        this.state.motionEnergy = smoothed;

        return smoothed;
    }
}

export default QuaternionFieldService;
