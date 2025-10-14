export class LayoutAnnotation {
    constructor({ id, priority = 100, dependsOn = [] } = {}) {
        if (!id) {
            throw new Error('LayoutAnnotation requires an `id`.');
        }
        this.id = id;
        this.priority = priority;
        this.dependsOn = dependsOn;
    }

    shouldApply() {
        return true;
    }

    build() {
        return null;
    }
}
