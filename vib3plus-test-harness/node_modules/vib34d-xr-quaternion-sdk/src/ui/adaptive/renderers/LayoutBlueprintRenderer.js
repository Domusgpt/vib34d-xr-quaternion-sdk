const DEFAULT_ZONE_COLORS = {
    primary: 'rgba(90, 197, 255, 0.85)',
    peripheral: 'rgba(125, 107, 255, 0.85)',
    ambient: 'rgba(255, 166, 87, 0.8)'
};

const DEFAULT_BACKGROUND = {
    inner: 'rgba(12, 26, 46, 0.4)',
    outer: 'rgba(6, 12, 22, 0.9)'
};

function toNumber(value, fallback = 0) {
    const cast = Number(value);
    return Number.isFinite(cast) ? cast : fallback;
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeFocusVector(vector = {}) {
    return {
        x: clamp(toNumber(vector.x, 0.5), 0, 1),
        y: clamp(toNumber(vector.y, 0.5), 0, 1),
        depth: clamp(toNumber(vector.depth, 0.3), 0, 1)
    };
}

function computeBiasAngle(bias = {}) {
    const x = toNumber(bias.x, 0);
    const y = toNumber(bias.y, 0);
    if (x === 0 && y === 0) {
        return -Math.PI / 2;
    }
    return Math.atan2(y, x);
}

export function buildLayoutBlueprint(layout = {}, design = {}, context = {}) {
    const focusVector = normalizeFocusVector(context.focusVector);
    const engagementLevel = clamp(toNumber(context.engagementLevel, 0.4), 0, 1);
    const biometricStress = clamp(toNumber(context.biometricStress, 0.18), 0, 1);
    const intensity = clamp(toNumber(layout.intensity, 0.5), 0, 1);
    const motion = layout.motion || { velocity: 0, bias: { x: 0, y: 0, z: 0 }, easing: 'ease-in-out' };

    const zones = Array.isArray(layout.zones) ? layout.zones : [];
    const orderedZones = [...zones].sort((a, b) => toNumber(b.layeringDepth, 0) - toNumber(a.layeringDepth, 0));

    const recommendedComponentSet = new Set();
    const zoneSummaries = orderedZones.map(zone => {
        const components = Array.isArray(zone.recommendedComponents) ? zone.recommendedComponents : [];
        components.forEach(component => recommendedComponentSet.add(component));

        const occupancy = clamp(toNumber(zone.occupancy, 0.4), 0, 1);
        const layeringDepth = clamp(toNumber(zone.layeringDepth, 0.25), 0, 1);
        const curvature = clamp(toNumber(zone.curvature, 0.3), 0, 1);
        const surfaceScore = Number(((occupancy * (1.1 - layeringDepth) * (0.85 + intensity * 0.3)) * (1 - biometricStress * 0.35)).toFixed(3));

        return {
            id: zone.id || 'zone',
            occupancy,
            layeringDepth,
            curvature,
            visibility: clamp(toNumber(zone.visibility, 0.6), 0, 1),
            components,
            surfaceScore
        };
    });

    const annotations = Array.isArray(layout.annotations) ? layout.annotations : [];

    return {
        generatedAt: new Date().toISOString(),
        intensity,
        engagementLevel,
        biometricStress,
        focusVector,
        motion: {
            velocity: clamp(toNumber(motion.velocity, 0), 0, 1),
            easing: motion.easing || 'ease-in-out',
            bias: {
                x: clamp(toNumber(motion.bias?.x, 0), -1, 1),
                y: clamp(toNumber(motion.bias?.y, 0), -1, 1),
                z: clamp(toNumber(motion.bias?.z, 0), -1, 1)
            }
        },
        pattern: design?.pattern || null,
        monetization: design?.monetization || null,
        integration: design?.integration || null,
        annotations,
        zones: zoneSummaries,
        recommendedComponents: Array.from(recommendedComponentSet)
    };
}

export class LayoutBlueprintRenderer {
    constructor(options = {}) {
        this.layers = new Map();
        this.zoneColors = { ...DEFAULT_ZONE_COLORS, ...(options.zoneColors || {}) };
        this.background = { ...DEFAULT_BACKGROUND, ...(options.background || {}) };
        this.devicePadding = options.devicePadding ?? 0.12;
        this.lastSize = 0;
        this.lastRenderPayload = null;
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

    attachLayer(id, canvas) {
        if (!canvas) return;
        const context = canvas.getContext('2d');
        if (!context) return;
        this.layers.set(id, { canvas, context });
        this.resizeCanvas(canvas);
    }

    detachLayer(id) {
        const layer = this.layers.get(id);
        if (!layer) return;
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
        if (this.lastRenderPayload) {
            this.render(this.lastRenderPayload.layout, this.lastRenderPayload.design, this.lastRenderPayload.context);
        }
    }

    resizeCanvas(canvas, size = null) {
        if (!canvas) return;
        const targetSize = size ?? this.lastSize ?? 720;
        canvas.width = targetSize;
        canvas.height = targetSize;
    }

    clearLayer(id) {
        const layer = this.layers.get(id);
        if (!layer) return;
        const { context, canvas } = layer;
        context.clearRect(0, 0, canvas.width, canvas.height);
    }

    clear() {
        for (const id of this.layers.keys()) {
            this.clearLayer(id);
        }
    }

    render(layout, design, context) {
        if (!layout) return;
        this.lastRenderPayload = { layout, design, context };
        if (!this.lastSize) {
            this.resize();
        }
        const size = this.lastSize || 720;
        const center = size / 2;
        const padding = size * this.devicePadding;
        const radius = center - padding;

        this.drawBackground(size);
        this.drawShadow(size, center, radius);
        this.drawZones(layout, size, center, radius);
        this.drawFocusHighlight(layout, context, size);
        this.drawAccent(layout, design, size, center);
    }

    drawBackground(size) {
        const layer = this.layers.get('background');
        if (!layer) return;
        const { context, canvas } = layer;
        context.clearRect(0, 0, canvas.width, canvas.height);
        const gradient = context.createRadialGradient(size / 2, size / 2, size * 0.1, size / 2, size / 2, size * 0.55);
        gradient.addColorStop(0, this.background.inner);
        gradient.addColorStop(1, this.background.outer);
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);
    }

    drawShadow(size, center, radius) {
        const layer = this.layers.get('shadow');
        if (!layer) return;
        const { context, canvas } = layer;
        context.clearRect(0, 0, canvas.width, canvas.height);
        context.save();
        context.fillStyle = 'rgba(0, 0, 0, 0.3)';
        context.filter = 'blur(40px)';
        context.beginPath();
        context.ellipse(center, center + radius * 0.18, radius * 0.68, radius * 0.32, 0, 0, Math.PI * 2);
        context.fill();
        context.restore();
    }

    drawZones(layout, size, center, radius) {
        const layer = this.layers.get('content');
        if (!layer) return;
        const { context, canvas } = layer;
        context.clearRect(0, 0, canvas.width, canvas.height);

        const zones = Array.isArray(layout.zones) ? [...layout.zones] : [];
        zones.sort((a, b) => toNumber(b.layeringDepth, 0) - toNumber(a.layeringDepth, 0));

        const biasAngle = computeBiasAngle(layout.motion?.bias);
        let currentRadius = radius;
        const baseThickness = size * 0.06;

        for (const zone of zones) {
            const color = this.zoneColors[zone.id] || 'rgba(255, 255, 255, 0.75)';
            const occupancy = clamp(toNumber(zone.occupancy, 0.45), 0.05, 1);
            const curvature = clamp(toNumber(zone.curvature, 0.4), 0.05, 1);
            const layeringDepth = clamp(toNumber(zone.layeringDepth, 0.3), 0.05, 1);
            const thickness = baseThickness * (0.6 + occupancy * 0.8);
            const sweep = Math.PI * (0.45 + occupancy * 0.9);
            const start = biasAngle - sweep / 2 + layeringDepth * 0.15;
            const end = start + sweep * (0.9 + curvature * 0.2);

            context.save();
            context.strokeStyle = color;
            context.lineWidth = thickness;
            context.globalAlpha = 0.65 + (occupancy * 0.25);
            context.lineCap = 'round';
            context.beginPath();
            context.arc(center, center, currentRadius, start, end);
            context.stroke();
            context.restore();

            if (Array.isArray(zone.recommendedComponents) && zone.recommendedComponents.length) {
                const angle = start + (end - start) * 0.65;
                const pointRadius = currentRadius;
                const x = center + Math.cos(angle) * pointRadius;
                const y = center + Math.sin(angle) * pointRadius;
                context.save();
                context.fillStyle = color;
                context.globalAlpha = 0.6;
                context.beginPath();
                context.arc(x, y, Math.max(4, thickness * 0.15), 0, Math.PI * 2);
                context.fill();
                context.restore();
            }

            currentRadius -= thickness * 0.8;
        }
    }

    drawFocusHighlight(layout, contextSnapshot, size) {
        const layer = this.layers.get('highlight');
        if (!layer) return;
        const { context, canvas } = layer;
        context.clearRect(0, 0, canvas.width, canvas.height);
        const focus = normalizeFocusVector(contextSnapshot?.focusVector);
        const radius = size * 0.12;
        const x = focus.x * size;
        const y = focus.y * size;

        const gradient = context.createRadialGradient(x, y, size * 0.01, x, y, radius);
        gradient.addColorStop(0, 'rgba(76, 159, 255, 0.5)');
        gradient.addColorStop(1, 'rgba(76, 159, 255, 0)');
        context.fillStyle = gradient;
        context.fillRect(0, 0, canvas.width, canvas.height);

        context.save();
        context.fillStyle = 'rgba(255, 255, 255, 0.9)';
        context.beginPath();
        context.arc(x, y, size * (0.01 + clamp(toNumber(layout.intensity, 0.5), 0, 1) * 0.015), 0, Math.PI * 2);
        context.fill();
        context.restore();
    }

    drawAccent(layout, design, size, center) {
        const layer = this.layers.get('accent');
        if (!layer) return;
        const { context, canvas } = layer;
        context.clearRect(0, 0, canvas.width, canvas.height);

        const patternName = design?.pattern?.name || 'Adaptive Pattern';
        const tier = design?.monetization?.tier || 'starter';
        const components = new Set();
        for (const zone of layout.zones || []) {
            if (Array.isArray(zone.recommendedComponents)) {
                for (const component of zone.recommendedComponents) {
                    components.add(component);
                }
            }
        }
        const componentLine = Array.from(components).join('  •  ');

        context.save();
        context.fillStyle = 'rgba(255, 255, 255, 0.82)';
        context.textAlign = 'center';
        context.font = `${Math.round(size * 0.04)}px "Inter", "Segoe UI", sans-serif`;
        context.fillText(patternName, center, size * 0.16);
        context.fillStyle = 'rgba(255, 255, 255, 0.58)';
        context.font = `${Math.round(size * 0.024)}px "Inter", "Segoe UI", sans-serif`;
        context.fillText(`Tier ${tier}`.toUpperCase(), center, size * 0.21);

        if (componentLine) {
            context.fillStyle = 'rgba(255, 255, 255, 0.72)';
            context.font = `${Math.round(size * 0.02)}px "Inter", "Segoe UI", sans-serif`;
            context.fillText(componentLine, center, size * 0.86);
        }

        const intensity = clamp(toNumber(layout.intensity, 0.5), 0, 1);
        const velocity = clamp(toNumber(layout.motion?.velocity, 0), 0, 1);
        const gaugeWidth = size * 0.18;
        const gaugeHeight = size * 0.006;
        const startX = center - gaugeWidth / 2;
        const baseY = size * 0.9;

        context.fillStyle = 'rgba(255, 255, 255, 0.12)';
        context.fillRect(startX, baseY, gaugeWidth, gaugeHeight);

        context.fillStyle = 'rgba(76, 159, 255, 0.85)';
        context.fillRect(startX, baseY, gaugeWidth * intensity, gaugeHeight);

        context.fillStyle = 'rgba(255, 166, 87, 0.8)';
        context.fillRect(startX, baseY + gaugeHeight * 2, gaugeWidth * velocity, gaugeHeight);

        context.restore();
    }
}

export function createLayoutBlueprintRenderer(options = {}) {
    return new LayoutBlueprintRenderer(options);
}
