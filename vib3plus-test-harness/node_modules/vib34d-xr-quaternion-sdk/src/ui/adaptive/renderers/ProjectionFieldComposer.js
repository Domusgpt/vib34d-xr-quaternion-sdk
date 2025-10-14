const DEFAULT_PROJECTION_OPTIONS = {
    resolution: 32,
    depthBands: 5,
    haloFalloff: 0.65,
    haloBaseRadius: 0.24,
    gestureWeight: 0.4,
    biasSmoothing: 0.45,
    bandEasing: 'ease-in-out'
};

function toNumber(value, fallback = 0) {
    const cast = Number(value);
    return Number.isFinite(cast) ? cast : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function lerp(a, b, t) {
    return a + (b - a) * clamp(t, 0, 1);
}

function ease(value, easing = 'ease-in-out') {
    const t = clamp(value, 0, 1);
    switch (easing) {
        case 'ease-out':
            return 1 - Math.pow(1 - t, 2);
        case 'ease-in':
            return Math.pow(t, 2);
        case 'linear':
            return t;
        default:
            return t < 0.5
                ? 2 * t * t
                : -1 + (4 - 2 * t) * t;
    }
}

function normalizeBlueprint(blueprint = {}) {
    return {
        intensity: clamp(toNumber(blueprint.intensity, 0.5), 0, 1),
        engagementLevel: clamp(toNumber(blueprint.engagementLevel, 0.5), 0, 1),
        biometricStress: clamp(toNumber(blueprint.biometricStress, 0.2), 0, 1),
        focusVector: {
            x: clamp(toNumber(blueprint.focusVector?.x, 0.5), 0, 1),
            y: clamp(toNumber(blueprint.focusVector?.y, 0.5), 0, 1),
            depth: clamp(toNumber(blueprint.focusVector?.depth, 0.3), 0, 1)
        },
        zones: Array.isArray(blueprint.zones) ? blueprint.zones : [],
        annotations: Array.isArray(blueprint.annotations) ? blueprint.annotations : []
    };
}

function normalizeContext(context = {}) {
    return {
        gazeVelocity: clamp(toNumber(context.gazeVelocity, 0.35), 0, 1),
        neuralCoherence: clamp(toNumber(context.neuralCoherence, 0.42), 0, 1),
        hapticFeedback: clamp(toNumber(context.hapticFeedback, 0.3), 0, 1),
        ambientVariance: clamp(toNumber(context.ambientVariance, 0.25), 0, 1),
        gestureIntent: {
            intensity: clamp(toNumber(context.gestureIntent?.intensity, 0.3), 0, 1),
            vector: {
                x: clamp(toNumber(context.gestureIntent?.vector?.x, 0.5), 0, 1),
                y: clamp(toNumber(context.gestureIntent?.vector?.y, 0.5), 0, 1),
                z: clamp(toNumber(context.gestureIntent?.vector?.z, 0.4), 0, 1)
            }
        }
    };
}

function computeDepthBands(options, blueprint, context) {
    const { depthBands, bandEasing } = options;
    const { focusVector, engagementLevel, biometricStress } = blueprint;
    const bands = [];
    const bandCount = Math.max(3, Math.round(depthBands));
    const depthBias = ease(focusVector.depth * (1 - biometricStress * 0.35), bandEasing);

    for (let index = 0; index < bandCount; index += 1) {
        const ratio = index / (bandCount - 1 || 1);
        const easedRatio = ease(ratio * (0.65 + engagementLevel * 0.35), bandEasing);
        const intensity = clamp(lerp(0.18, 0.92, easedRatio * (0.7 + context.neuralCoherence * 0.3)), 0, 1);
        bands.push({
            id: `band-${index}`,
            index,
            ratio,
            intensity,
            depth: clamp(easedRatio * (0.8 + depthBias * 0.2), 0, 1)
        });
    }

    return bands;
}

function computeFocusHalo(options, blueprint, context) {
    const { haloBaseRadius, haloFalloff } = options;
    const intensity = blueprint.intensity;
    const engagement = blueprint.engagementLevel;
    const stress = blueprint.biometricStress;
    const coherence = context.neuralCoherence;

    const baseRadius = haloBaseRadius * (0.8 + engagement * 0.4);
    const stressPenalty = (1 - stress * 0.65);
    const coherenceBoost = 0.9 + coherence * 0.2;
    const velocityBias = 0.85 + context.gazeVelocity * 0.25;

    const radius = clamp(baseRadius * stressPenalty * coherenceBoost * velocityBias, 0.12, 0.6);
    const falloff = clamp(haloFalloff * (1 - stress * 0.35) * (0.85 + intensity * 0.2), 0.3, 0.92);

    return {
        radius,
        falloff,
        origin: blueprint.focusVector,
        stressPenalty,
        coherenceBoost
    };
}

function computeGestureContours(options, blueprint, context) {
    const { gestureWeight, biasSmoothing } = options;
    const { zones } = blueprint;
    const { gestureIntent } = context;

    const contourCount = Math.max(3, Math.round(gestureWeight * 9));
    const contours = [];

    for (let index = 0; index < contourCount; index += 1) {
        const zone = zones[index % (zones.length || 1)] || {};
        const occupancy = clamp(toNumber(zone.occupancy, 0.4), 0, 1);
        const visibility = clamp(toNumber(zone.visibility, 0.5), 0, 1);
        const curvature = clamp(toNumber(zone.curvature, 0.4), 0, 1);
        const intensity = clamp(gestureIntent.intensity * (0.6 + visibility * 0.4), 0, 1);

        contours.push({
            id: `contour-${index}`,
            orbit: clamp(0.25 + occupancy * 0.6, 0.2, 0.92),
            curvature,
            visibility,
            intensity,
            zoneId: zone.id || `zone-${index}`,
            bias: {
                x: clamp(lerp(gestureIntent.vector.x, blueprint.focusVector.x, biasSmoothing), 0, 1),
                y: clamp(lerp(gestureIntent.vector.y, blueprint.focusVector.y, biasSmoothing), 0, 1),
                z: clamp(lerp(gestureIntent.vector.z, blueprint.focusVector.depth, biasSmoothing), 0, 1)
            }
        });
    }

    return contours;
}

function computeInteractionLobes(blueprint, context) {
    const { zones } = blueprint;
    const lobes = [];

    const baseVolume = clamp((blueprint.intensity + context.neuralCoherence) / 2, 0, 1);
    const stressFactor = 1 - blueprint.biometricStress * 0.55;

    for (const zone of zones) {
        const layeringDepth = clamp(toNumber(zone.layeringDepth, 0.3), 0, 1);
        const visibility = clamp(toNumber(zone.visibility, 0.6), 0, 1);
        const occupancy = clamp(toNumber(zone.occupancy, 0.5), 0, 1);
        const lobeVolume = clamp(baseVolume * (0.7 + visibility * 0.3) * (0.8 + occupancy * 0.2) * stressFactor, 0.1, 1);

        lobes.push({
            id: zone.id || `lobe-${lobes.length}`,
            volume: lobeVolume,
            layeringDepth,
            visibility,
            saturation: clamp(0.45 + occupancy * 0.4, 0.2, 1)
        });
    }

    return lobes;
}

function computeActivationMatrix(options, blueprint, context) {
    const resolution = Math.max(8, Math.round(options.resolution));
    const matrix = [];
    const halo = computeFocusHalo(options, blueprint, context);

    for (let row = 0; row < resolution; row += 1) {
        const rowValues = [];
        for (let col = 0; col < resolution; col += 1) {
            const x = col / (resolution - 1);
            const y = row / (resolution - 1);
            const dx = x - halo.origin.x;
            const dy = y - halo.origin.y;
            const distance = Math.sqrt(dx * dx + dy * dy);
            const haloInfluence = Math.exp(-Math.pow(distance / halo.radius, 2)) * halo.falloff;
            const engagementInfluence = blueprint.engagementLevel * 0.5;
            const ambientInfluence = context.ambientVariance * 0.3;
            const total = clamp(haloInfluence + engagementInfluence + ambientInfluence, 0, 1);
            rowValues.push(Number(total.toFixed(3)));
        }
        matrix.push(rowValues);
    }

    return matrix;
}

export function composeProjectionField(blueprint, context = {}, options = {}) {
    const normalizedBlueprint = normalizeBlueprint(blueprint);
    const normalizedContext = normalizeContext(context);
    const mergedOptions = { ...DEFAULT_PROJECTION_OPTIONS, ...(options || {}) };

    const depthBands = computeDepthBands(mergedOptions, normalizedBlueprint, normalizedContext);
    const focusHalo = computeFocusHalo(mergedOptions, normalizedBlueprint, normalizedContext);
    const gestureContours = computeGestureContours(mergedOptions, normalizedBlueprint, normalizedContext);
    const interactionLobes = computeInteractionLobes(normalizedBlueprint, normalizedContext);
    const activationMatrix = computeActivationMatrix(mergedOptions, normalizedBlueprint, normalizedContext);

    const blueprintAnnotations = normalizedBlueprint.annotations.map(annotation => ({
        id: annotation.id || 'annotation',
        type: annotation.type || 'note',
        priority: toNumber(annotation.priority, 0)
    }));

    return {
        generatedAt: new Date().toISOString(),
        options: {
            resolution: mergedOptions.resolution,
            depthBands: mergedOptions.depthBands,
            haloFalloff: mergedOptions.haloFalloff,
            haloBaseRadius: mergedOptions.haloBaseRadius,
            gestureWeight: mergedOptions.gestureWeight,
            biasSmoothing: mergedOptions.biasSmoothing,
            bandEasing: mergedOptions.bandEasing
        },
        focusHalo,
        depthBands,
        gestureContours,
        interactionLobes,
        activationMatrix,
        annotations: blueprintAnnotations,
        context: normalizedContext,
        blueprint: normalizedBlueprint
    };
}

export class ProjectionFieldComposer {
    constructor(options = {}) {
        this.layers = new Map();
        this.options = { ...DEFAULT_PROJECTION_OPTIONS, ...(options || {}) };
        this.lastComposition = null;
        this.lastSize = 0;
        this.resizeObserver = null;

        if (options.layers) {
            for (const [id, canvas] of Object.entries(options.layers)) {
                this.attachLayer(id, canvas);
            }
        }

        if (options.observe !== false) {
            this.observeResize();
        }
    }

    setOptions(options = {}) {
        this.options = { ...this.options, ...(options || {}) };
        if (this.lastComposition) {
            this.render(this.lastComposition.blueprint, this.lastComposition.context);
        }
    }

    attachLayer(id, canvas) {
        if (!canvas || typeof canvas.getContext !== 'function') {
            return;
        }
        const context = canvas.getContext('2d');
        if (!context) {
            return;
        }
        this.layers.set(id, { canvas, context });
        this.resizeCanvas(canvas);
    }

    detachLayer(id) {
        this.layers.delete(id);
    }

    get container() {
        const first = this.layers.values().next();
        if (first.done) return null;
        return first.value.canvas.parentElement || null;
    }

    observeResize() {
        const container = this.container;
        if (!container || typeof ResizeObserver === 'undefined') {
            return;
        }
        this.resizeObserver?.disconnect?.();
        this.resizeObserver = new ResizeObserver(() => this.resize());
        this.resizeObserver.observe(container);
    }

    resize() {
        const container = this.container;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const size = Math.floor(Math.min(rect.width, rect.height));
        if (!size || size === this.lastSize) {
            return;
        }
        this.lastSize = size;
        for (const { canvas } of this.layers.values()) {
            this.resizeCanvas(canvas, size);
        }
        if (this.lastComposition) {
            this.render(this.lastComposition.blueprint, this.lastComposition.context);
        }
    }

    resizeCanvas(canvas, size = this.lastSize || 480) {
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        canvas.width = size * dpr;
        canvas.height = size * dpr;
        canvas.style.width = `${size}px`;
        canvas.style.height = `${size}px`;
        const context = canvas.getContext('2d');
        if (context) {
            context.reset?.();
            context.scale(dpr, dpr);
        }
    }

    compose(blueprint, context = {}, options = {}) {
        const composition = composeProjectionField(blueprint, context, { ...this.options, ...(options || {}) });
        this.lastComposition = composition;
        return composition;
    }

    render(blueprint, context = {}, options = {}) {
        const composition = this.compose(blueprint, context, options);
        this.drawComposition(composition);
        return composition;
    }

    drawComposition(composition) {
        if (!composition) return;
        const size = this.lastSize || this.estimateSize();
        if (!size) return;

        const baseLayer = this.layers.get('base');
        const haloLayer = this.layers.get('halo');
        const bandLayer = this.layers.get('bands');
        const contourLayer = this.layers.get('contours');

        if (baseLayer) {
            this.drawActivationMatrix(baseLayer.context, size, composition);
        }
        if (bandLayer) {
            this.drawDepthBands(bandLayer.context, size, composition);
        }
        if (haloLayer) {
            this.drawFocusHalo(haloLayer.context, size, composition);
        }
        if (contourLayer) {
            this.drawGestureContours(contourLayer.context, size, composition);
        }
    }

    estimateSize() {
        const container = this.container;
        if (!container) return 0;
        const rect = container.getBoundingClientRect();
        const size = Math.floor(Math.min(rect.width, rect.height));
        if (size && size !== this.lastSize) {
            this.lastSize = size;
        }
        return this.lastSize;
    }

    clear() {
        for (const { context, canvas } of this.layers.values()) {
            context.clearRect(0, 0, canvas.width, canvas.height);
        }
    }

    drawActivationMatrix(context, size, composition) {
        context.clearRect(0, 0, size, size);
        const { activationMatrix } = composition;
        const rows = activationMatrix.length;
        const cols = activationMatrix[0]?.length || 0;
        if (!rows || !cols) {
            return;
        }
        const cellWidth = size / cols;
        const cellHeight = size / rows;
        for (let row = 0; row < rows; row += 1) {
            for (let col = 0; col < cols; col += 1) {
                const value = activationMatrix[row][col];
                context.fillStyle = `rgba(76, 159, 255, ${value * 0.6})`;
                context.fillRect(col * cellWidth, row * cellHeight, cellWidth + 0.5, cellHeight + 0.5);
            }
        }
    }

    drawDepthBands(context, size, composition) {
        context.clearRect(0, 0, size, size);
        context.save();
        context.translate(size / 2, size / 2);
        const maxRadius = size * 0.46;
        for (const band of composition.depthBands) {
            const radius = maxRadius * band.depth;
            context.beginPath();
            context.strokeStyle = `rgba(171, 120, 255, ${0.22 + band.intensity * 0.4})`;
            context.lineWidth = Math.max(1, radius * 0.04);
            context.arc(0, 0, radius, 0, Math.PI * 2);
            context.stroke();
        }
        context.restore();
    }

    drawFocusHalo(context, size, composition) {
        context.clearRect(0, 0, size, size);
        const centerX = composition.focusHalo.origin.x * size;
        const centerY = composition.focusHalo.origin.y * size;
        const radius = composition.focusHalo.radius * size;

        const gradient = context.createRadialGradient(centerX, centerY, radius * 0.2, centerX, centerY, radius);
        gradient.addColorStop(0, 'rgba(255, 255, 255, 0.8)');
        gradient.addColorStop(0.45, 'rgba(76, 159, 255, 0.65)');
        gradient.addColorStop(1, 'rgba(76, 159, 255, 0)');

        context.fillStyle = gradient;
        context.beginPath();
        context.arc(centerX, centerY, radius, 0, Math.PI * 2);
        context.fill();
    }

    drawGestureContours(context, size, composition) {
        context.clearRect(0, 0, size, size);
        context.save();
        for (const contour of composition.gestureContours) {
            const radius = size * contour.orbit * 0.48;
            const centerX = contour.bias.x * size;
            const centerY = contour.bias.y * size;
            const angle = contour.bias.z * Math.PI * 2;
            const arc = Math.PI * (0.35 + contour.curvature * 0.6);
            context.beginPath();
            context.strokeStyle = `rgba(255, 166, 87, ${0.35 + contour.intensity * 0.5})`;
            context.lineWidth = Math.max(1.2, size * 0.01 * (0.6 + contour.intensity * 0.6));
            context.arc(centerX, centerY, radius, angle - arc / 2, angle + arc / 2);
            context.stroke();
        }
        context.restore();
    }
}

export function createProjectionFieldComposer(options = {}) {
    return new ProjectionFieldComposer(options);
}

