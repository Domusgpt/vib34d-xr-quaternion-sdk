import {
    normalizeQuaternion,
    createIdentityQuaternion
} from '../../../../core/quaternions/QuaternionFieldService.js';

const TRACKING_STATE_MAP = new Map([
    ['tracking', 'tracked'],
    ['tracked', 'tracked'],
    ['emulated', 'emulated'],
    ['paused', 'paused'],
    ['lost', 'lost'],
    ['unknown', 'unknown']
]);

const ARRAY_LIKE_GETTERS = {
    x: 0,
    y: 1,
    z: 2,
    w: 3
};

const clamp01 = value => {
    if (!Number.isFinite(value)) {
        return 0;
    }
    if (value <= 0) return 0;
    if (value >= 1) return 1;
    return value;
};

const isTypedArray = value => ArrayBuffer.isView(value) && typeof value.length === 'number';

const isDOMPointLike = value => Boolean(value) && typeof value === 'object'
    && ['x', 'y', 'z'].every(component => typeof value[component] === 'number');

const coerceVectorLike = source => {
    if (!source && source !== 0) {
        return null;
    }

    if (isDOMPointLike(source)) {
        return { x: source.x, y: source.y, z: source.z };
    }

    if (Array.isArray(source) || isTypedArray(source)) {
        return {
            x: Number(source[0]) || 0,
            y: Number(source[1]) || 0,
            z: Number(source[2]) || 0
        };
    }

    if (typeof source === 'object') {
        const x = Number(source.x ?? source.X ?? source.lat ?? source.longitude);
        const y = Number(source.y ?? source.Y ?? source.lng ?? source.latitude);
        const z = Number(source.z ?? source.Z ?? source.alt ?? source.altitude);

        if ([x, y, z].some(component => Number.isFinite(component))) {
            return {
                x: Number.isFinite(x) ? x : 0,
                y: Number.isFinite(y) ? y : 0,
                z: Number.isFinite(z) ? z : 0
            };
        }
    }

    return null;
};

const coerceQuaternionLike = source => {
    if (!source && source !== 0) {
        return null;
    }

    if (typeof source === 'object') {
        if (typeof source.x === 'number' && typeof source.y === 'number' && typeof source.z === 'number') {
            const w = typeof source.w === 'number' ? source.w : undefined;
            return { x: source.x, y: source.y, z: source.z, w };
        }

        if (Array.isArray(source) || isTypedArray(source)) {
            return {
                x: Number(source[ARRAY_LIKE_GETTERS.x]) || 0,
                y: Number(source[ARRAY_LIKE_GETTERS.y]) || 0,
                z: Number(source[ARRAY_LIKE_GETTERS.z]) || 0,
                w: Number(source[ARRAY_LIKE_GETTERS.w]) || undefined
            };
        }
    }

    return null;
};

const resolveTransform = payload => {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    if (payload.transform && typeof payload.transform === 'object') {
        return payload.transform;
    }

    if (payload.pose && typeof payload.pose === 'object') {
        return resolveTransform(payload.pose);
    }

    if (payload.targetRayPose && typeof payload.targetRayPose === 'object') {
        return resolveTransform(payload.targetRayPose);
    }

    if (payload.inputSource && typeof payload.inputSource === 'object' && payload.inputSource.gripSpace) {
        return resolveTransform(payload.inputSource);
    }

    if (payload.position && payload.orientation) {
        return payload;
    }

    return null;
};

const resolveSpace = payload => {
    if (!payload || typeof payload !== 'object') {
        return null;
    }

    if (payload.space && typeof payload.space === 'object') {
        return payload.space;
    }

    if (payload.referenceSpace && typeof payload.referenceSpace === 'object') {
        return payload.referenceSpace;
    }

    if (payload.targetRaySpace && typeof payload.targetRaySpace === 'object') {
        return payload.targetRaySpace;
    }

    return null;
};

const resolveTrackingState = payload => {
    if (!payload || typeof payload !== 'object') {
        return 'unknown';
    }

    const candidates = [
        payload.trackingState,
        payload.trackingStatus,
        payload.state,
        payload.inputSource?.gamepad?.handTrackingState,
        payload.space?.trackingState,
        payload.referenceSpace?.trackingState
    ];

    for (const candidate of candidates) {
        if (typeof candidate === 'string' && candidate) {
            const normalized = TRACKING_STATE_MAP.get(candidate.toLowerCase());
            if (normalized) {
                return normalized;
            }
        }
    }

    return 'unknown';
};

const deriveConfidence = ({
    baseConfidence,
    emulatedPosition,
    trackingState
}) => {
    if (Number.isFinite(baseConfidence)) {
        return clamp01(baseConfidence);
    }

    let confidence = 1;

    if (emulatedPosition === true) {
        confidence *= 0.65;
    }

    if (trackingState === 'emulated') {
        confidence *= 0.7;
    } else if (trackingState === 'paused' || trackingState === 'lost') {
        confidence *= 0.5;
    }

    return clamp01(confidence);
};

/**
 * Normalize heterogeneous XR pose payloads (WebXR, OpenXR, custom wearables)
 * into the structure expected by the SensorSchemaRegistry.
 *
 * @param {any} payload - Raw pose-like input.
 * @param {{ registry: import('../SensorSchemaRegistry.js').SensorSchemaRegistry }} context
 */
export function normalizeXRPosePayload(payload, context = {}) {
    const { registry } = context;
    if (!registry) {
        throw new TypeError('normalizeXRPosePayload requires a SensorSchemaRegistry instance.');
    }

    const issues = [];
    const transform = resolveTransform(payload) || {};
    const space = resolveSpace(payload);

    const positionVector = coerceVectorLike(transform.position || payload?.position || payload?.origin);
    const orientationQuaternion = coerceQuaternionLike(transform.orientation || payload?.orientation || payload?.quaternion);
    const linearVelocityVector = coerceVectorLike(payload?.linearVelocity || transform.linearVelocity || payload?.velocity);
    const angularVelocityVector = coerceVectorLike(payload?.angularVelocity || transform.angularVelocity);

    const position = registry.ensureVector(positionVector ?? {}, {
        field: 'pose.position',
        defaultValue: 0,
        issues
    });

    const orientationInput = orientationQuaternion ?? createIdentityQuaternion();
    const orientationEnsured = registry.ensureQuaternion(orientationInput, {
        field: 'pose.orientation',
        issues
    });
    const orientation = normalizeQuaternion(orientationEnsured);

    const linearVelocity = linearVelocityVector
        ? registry.ensureVector(linearVelocityVector, {
            field: 'pose.linearVelocity',
            defaultValue: 0,
            issues
        })
        : null;

    const angularVelocity = angularVelocityVector
        ? registry.ensureVector(angularVelocityVector, {
            field: 'pose.angularVelocity',
            defaultValue: 0,
            issues
        })
        : null;

    const emulatedPosition = typeof payload?.emulatedPosition === 'boolean'
        ? payload.emulatedPosition
        : typeof transform.emulatedPosition === 'boolean'
            ? transform.emulatedPosition
            : null;

    const trackingState = resolveTrackingState(payload);

    let radius = null;
    if (typeof payload?.radius === 'number') {
        radius = registry.ensureNumber(payload.radius, {
            field: 'pose.radius',
            min: 0,
            max: 10,
            defaultValue: null,
            issues
        });
    } else if (typeof payload?.jointRadius === 'number') {
        radius = registry.ensureNumber(payload.jointRadius, {
            field: 'pose.radius',
            min: 0,
            max: 10,
            defaultValue: null,
            issues
        });
    }

    const baseConfidence = typeof payload?.confidence === 'number'
        ? payload.confidence
        : typeof payload?.trackingConfidence === 'number'
            ? payload.trackingConfidence
            : undefined;

    const confidence = deriveConfidence({ baseConfidence, emulatedPosition, trackingState });

    const referenceSpaceType = typeof space?.type === 'string' ? space.type : null;
    const referenceSpaceId = typeof space?.id === 'string' && space.id !== '' ? space.id : null;

    return {
        pose: {
            position,
            orientation,
            linearVelocity,
            angularVelocity,
            referenceSpaceType,
            referenceSpaceId,
            emulatedPosition,
            trackingState,
            radius,
            confidence
        },
        issues
    };
}

export default normalizeXRPosePayload;
