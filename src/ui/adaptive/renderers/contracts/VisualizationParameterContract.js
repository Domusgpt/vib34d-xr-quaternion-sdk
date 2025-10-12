/**
 * Visualization Parameter Contract helpers
 * ------------------------------------------------------------
 * Defines the shared interface consumed by the faceted, quantum, and
 * holographic visualization systems. Provides helpers for retrieving
 * parameter values and applying batched updates while gracefully falling
 * back to legacy single-parameter mutation paths.
 */

/**
 * @typedef {Object} VisualizationParameterContext
 * @property {number} [confidence] - Normalised [0-1] confidence derived from XR tracking.
 * @property {number} [motionEnergy] - Smoothed angular velocity envelope produced by quaternion services.
 * @property {{ roll: number, pitch: number, yaw: number }} [euler] - Euler angles derived from the active quaternion.
 * @property {string} [source] - Human-readable source identifier (e.g. `spatial.pose`).
 */

/**
 * @typedef {Object} VisualizationParameterConsumer
 * @property {(param: string, value: number, context?: VisualizationParameterContext) => void} updateParameter
 * @property {(params: Record<string, number>, context?: VisualizationParameterContext) => void} [updateParameters]
 * @property {(params: Record<string, number>, context?: VisualizationParameterContext) => void} [batchUpdate]
 * @property {(param: string) => number} [getParameter]
 * @property {Record<string, number> | Map<string, number>} [parameters]
 * @property {Record<string, number>} [params]
 * @property {Record<string, number>} [customParams]
 */

const isPlainObject = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);

const toEntries = updates => {
    if (!updates && updates !== 0) {
        return [];
    }

    if (updates instanceof Map) {
        return Array.from(updates.entries());
    }

    if (isPlainObject(updates)) {
        return Object.entries(updates);
    }

    return [];
};

const toPayloadObject = updates => {
    const entries = toEntries(updates)
        .map(([key, value]) => [key, Number(value)])
        .filter(([key, value]) => typeof key === 'string' && Number.isFinite(value));

    if (entries.length === 0) {
        return null;
    }

    return Object.fromEntries(entries);
};

/**
 * Resolve the current value for a visualization parameter across the diverse
 * system implementations in the codebase.
 *
 * @param {VisualizationParameterConsumer} system
 * @param {string} param
 * @returns {number}
 */
export function getVisualizationParameter(system, param) {
    if (!system) {
        return 0;
    }

    if (typeof system.getParameter === 'function') {
        const value = Number(system.getParameter(param));
        if (Number.isFinite(value)) {
            return value;
        }
    }

    const container = system.parameters;
    if (container instanceof Map && container.has(param)) {
        const value = Number(container.get(param));
        if (Number.isFinite(value)) {
            return value;
        }
    } else if (container && typeof container === 'object') {
        if (typeof container.getParameter === 'function') {
            const value = Number(container.getParameter(param));
            if (Number.isFinite(value)) {
                return value;
            }
        }
        if (Object.prototype.hasOwnProperty.call(container, param)) {
            const value = Number(container[param]);
            if (Number.isFinite(value)) {
                return value;
            }
        }
    }

    if (system.params && Object.prototype.hasOwnProperty.call(system.params, param)) {
        const value = Number(system.params[param]);
        if (Number.isFinite(value)) {
            return value;
        }
    }

    if (system.customParams && Object.prototype.hasOwnProperty.call(system.customParams, param)) {
        const value = Number(system.customParams[param]);
        if (Number.isFinite(value)) {
            return value;
        }
    }

    return 0;
}

/**
 * Apply a batch of parameter updates to a visualization system while
 * preferring the new `batchUpdate` contract. Falls back to legacy
 * `updateParameters` or `updateParameter` calls when required.
 *
 * @param {string} systemName
 * @param {VisualizationParameterConsumer} system
 * @param {Map<string, number> | Record<string, number>} updates
 * @param {VisualizationParameterContext} [context]
 * @param {{ warn?: Function }} [logger]
 * @returns {boolean} Whether any update path executed.
 */
export function applyVisualizationUpdates(systemName, system, updates, context = {}, logger = console) {
    if (!system) {
        return false;
    }

    const payload = toPayloadObject(updates);
    if (!payload) {
        return false;
    }

    if (typeof system.batchUpdate === 'function') {
        try {
            system.batchUpdate(payload, context);
            return true;
        } catch (error) {
            logger?.warn?.(`[VisualizationParameterContract] ${systemName} batchUpdate failed`, error);
        }
    }

    if (typeof system.updateParameters === 'function') {
        try {
            system.updateParameters(payload, context);
            return true;
        } catch (error) {
            logger?.warn?.(`[VisualizationParameterContract] ${systemName} updateParameters failed`, error);
        }
    }

    if (typeof system.updateParameter === 'function') {
        let applied = false;
        for (const [param, value] of Object.entries(payload)) {
            try {
                system.updateParameter(param, value, context);
                applied = true;
            } catch (error) {
                logger?.warn?.(`[VisualizationParameterContract] ${systemName} updateParameter failed`, { param, error });
            }
        }
        return applied;
    }

    return false;
}

export default {
    getVisualizationParameter,
    applyVisualizationUpdates
};
