export class LayoutStrategy {
    constructor({ id, priority = 100 } = {}) {
        if (!id) {
            throw new Error('LayoutStrategy requires an `id`.');
        }
        this.id = id;
        this.priority = priority;
    }

    prepare() {
        return undefined;
    }

    compose() {
        return undefined;
    }
}
