import { LayoutAnnotation } from './LayoutAnnotation.js';

export class StressAlertAnnotation extends LayoutAnnotation {
    constructor(options = {}) {
        super({ id: 'stress-alert', priority: options.priority ?? 20 });
        this.threshold = options.threshold ?? 0.5;
    }

    shouldApply({ shared }) {
        return (shared.focus?.stress ?? 0) >= this.threshold;
    }

    build({ context, shared }) {
        const stress = shared.focus?.stress ?? context.biometricStress ?? 0;
        return {
            type: 'alert',
            severity: stress > 0.75 ? 'critical' : 'elevated',
            message: 'Biometric stress trending high – enable haptic reassurance.',
            data: {
                stress,
                timestamp: Date.now()
            }
        };
    }
}
