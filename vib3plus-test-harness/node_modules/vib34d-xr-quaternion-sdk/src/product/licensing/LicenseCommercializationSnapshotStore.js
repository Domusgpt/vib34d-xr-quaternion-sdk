import { LicenseCommercializationReporter } from './LicenseCommercializationReporter.js';

function clone(value) {
    if (value === undefined || value === null) return value;
    if (typeof value !== 'object') return value;
    return JSON.parse(JSON.stringify(value));
}

function isPromise(value) {
    return Boolean(value) && typeof value.then === 'function';
}

function guardAsync(result, message) {
    if (isPromise(result)) {
        result.catch(error => {
            console?.warn?.(message, error);
        });
    }
}

function computeKpis(summary = {}) {
    const packs = Array.isArray(summary.packs) ? summary.packs : [];
    const profiles = Array.isArray(summary.profiles) ? summary.profiles : [];
    const segments = summary.segments && typeof summary.segments === 'object' ? summary.segments : {};
    const regions = summary.regions && typeof summary.regions === 'object' ? summary.regions : {};

    const totalAdoption = profiles.reduce((sum, profile) => sum + (profile?.adoptionCount || 0), 0);
    const activePacks = packs.filter(pack => (pack?.adoptionCount || 0) > 0).length;
    const activeProfiles = profiles.filter(profile => (profile?.adoptionCount || 0) > 0).length;

    const adoptionPerPack = packs.length > 0 ? totalAdoption / packs.length : 0;
    const adoptionPerProfile = profiles.length > 0 ? totalAdoption / profiles.length : 0;

    const topSegments = Object.entries(segments)
        .map(([key, data]) => ({ key, adoption: data?.adoptionCount || 0, profiles: data?.profileCount || 0 }))
        .sort((a, b) => b.adoption - a.adoption)
        .slice(0, 3);

    const topRegions = Object.entries(regions)
        .map(([key, data]) => ({ key, adoption: data?.adoptionCount || 0, profiles: data?.profileCount || 0 }))
        .sort((a, b) => b.adoption - a.adoption)
        .slice(0, 3);

    return {
        totalPacks: packs.length,
        totalProfiles: profiles.length,
        totalAdoption,
        activePacks,
        activeProfiles,
        adoptionPerPack,
        adoptionPerProfile,
        segmentCount: Object.keys(segments).length,
        regionCount: Object.keys(regions).length,
        defaultProfileId: summary.defaultProfileId || null,
        lastUpdated: summary.lastUpdated || null,
        topSegments,
        topRegions
    };
}

function normalizeSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') return null;
    const capturedAt = snapshot.capturedAt ? new Date(snapshot.capturedAt).toISOString() : new Date().toISOString();
    const summary = clone(snapshot.summary);
    const context = snapshot.context && typeof snapshot.context === 'object' ? clone(snapshot.context) : {};
    const kpis = snapshot.kpis && typeof snapshot.kpis === 'object' ? { ...snapshot.kpis } : computeKpis(summary);

    return {
        id: snapshot.id || capturedAt,
        capturedAt,
        summary,
        context,
        kpis
    };
}

export class LicenseCommercializationSnapshotStore {
    constructor(options = {}) {
        this.maxSnapshots = Number.isFinite(options.maxSnapshots) ? Math.max(1, options.maxSnapshots) : 120;
        this.snapshots = [];
        this.storage = options.storage || null;
        this.onChange = typeof options.onChange === 'function' ? options.onChange : null;

        this.readyPromise = Promise.resolve(this.getSnapshots());
        this.initializeFromStorage();
    }

    persist() {
        if (this.storage && typeof this.storage.saveSnapshots === 'function') {
            try {
                const result = this.storage.saveSnapshots(this.snapshots.map(snapshot => clone(snapshot)));
                guardAsync(result, 'LicenseCommercializationSnapshotStore persist failed');
            } catch (error) {
                console?.warn?.('LicenseCommercializationSnapshotStore persist failed', error);
            }
        }
    }

    notifyChange() {
        if (this.onChange) {
            try {
                this.onChange(this.getSnapshots());
            } catch (error) {
                console?.warn?.('LicenseCommercializationSnapshotStore onChange failed', error);
            }
        }
    }

    recordSnapshot(summary, context = {}) {
        const normalizedSummary = summary instanceof LicenseCommercializationReporter ? summary.getSummary() : summary;
        const snapshot = normalizeSnapshot({
            summary: clone(normalizedSummary),
            context: clone(context),
            capturedAt: new Date().toISOString()
        });

        this.snapshots.unshift(snapshot);
        if (this.snapshots.length > this.maxSnapshots) {
            this.snapshots.length = this.maxSnapshots;
        }
        this.persist();
        if (this.storage && typeof this.storage.appendSnapshot === 'function') {
            try {
                const result = this.storage.appendSnapshot(clone(snapshot));
                guardAsync(result, 'LicenseCommercializationSnapshotStore append failed');
            } catch (error) {
                console?.warn?.('LicenseCommercializationSnapshotStore append failed', error);
            }
        }
        this.notifyChange();
        return clone(snapshot);
    }

    getSnapshots(options = {}) {
        const limit = Number.isFinite(options.limit) ? Math.max(1, options.limit) : this.snapshots.length;
        const results = this.snapshots.slice(0, limit).map(snapshot => clone(snapshot));
        if (options.withSummary === false) {
            return results.map(snapshot => ({
                id: snapshot.id,
                capturedAt: snapshot.capturedAt,
                context: snapshot.context,
                kpis: snapshot.kpis
            }));
        }
        return results;
    }

    getLatestSnapshot() {
        if (this.snapshots.length === 0) return null;
        return clone(this.snapshots[0]);
    }

    getKpiReport(options = {}) {
        const snapshots = this.getSnapshots({ limit: options.limit ?? 2 });
        const latest = snapshots[0] || null;
        const previous = snapshots[1] || null;
        const deltas = {};

        if (latest && previous) {
            for (const key of Object.keys(latest.kpis || {})) {
                if (typeof latest.kpis[key] === 'number' && typeof previous.kpis?.[key] === 'number') {
                    deltas[key] = latest.kpis[key] - previous.kpis[key];
                }
            }
        }

        return {
            latest,
            previous,
            deltas
        };
    }

    exportForBi(options = {}) {
        const format = options.format || 'object';
        const includeSummary = options.includeSummary ?? true;
        const payload = {
            generatedAt: new Date().toISOString(),
            snapshotCount: this.snapshots.length,
            snapshots: this.snapshots.map(snapshot => {
                const entry = {
                    id: snapshot.id,
                    capturedAt: snapshot.capturedAt,
                    context: clone(snapshot.context),
                    kpis: { ...snapshot.kpis }
                };
                if (includeSummary) {
                    entry.summary = clone(snapshot.summary);
                }
                return entry;
            })
        };

        if (format === 'json') {
            return JSON.stringify(payload, null, options.pretty === false ? 0 : 2);
        }

        if (format === 'csv') {
            const headers = [
                'id',
                'capturedAt',
                'totalPacks',
                'totalProfiles',
                'totalAdoption',
                'activePacks',
                'activeProfiles',
                'adoptionPerPack',
                'adoptionPerProfile',
                'segmentCount',
                'regionCount',
                'defaultProfileId'
            ];
            const rows = [headers.join(',')];
            for (const snapshot of payload.snapshots) {
                const { kpis } = snapshot;
                rows.push([
                    snapshot.id,
                    snapshot.capturedAt,
                    kpis.totalPacks ?? '',
                    kpis.totalProfiles ?? '',
                    kpis.totalAdoption ?? '',
                    kpis.activePacks ?? '',
                    kpis.activeProfiles ?? '',
                    kpis.adoptionPerPack ?? '',
                    kpis.adoptionPerProfile ?? '',
                    kpis.segmentCount ?? '',
                    kpis.regionCount ?? '',
                    kpis.defaultProfileId ?? ''
                ].join(','));
            }
            return rows.join('\n');
        }

        return payload;
    }

    clearSnapshots() {
        this.snapshots = [];
        this.persist();
        if (this.storage && typeof this.storage.clearSnapshots === 'function') {
            try {
                const result = this.storage.clearSnapshots();
                guardAsync(result, 'LicenseCommercializationSnapshotStore clear failed');
            } catch (error) {
                console?.warn?.('LicenseCommercializationSnapshotStore clear failed', error);
            }
        }
        this.notifyChange();
    }

    whenReady() {
        return this.readyPromise;
    }

    initializeFromStorage() {
        if (!this.storage || typeof this.storage.loadSnapshots !== 'function') {
            this.readyPromise = Promise.resolve(this.getSnapshots());
            return;
        }

        try {
            const loaded = this.storage.loadSnapshots();
            if (isPromise(loaded)) {
                this.readyPromise = loaded
                    .then(data => {
                        this.applyLoadedSnapshots(data);
                        return this.getSnapshots();
                    })
                    .catch(error => {
                        console?.warn?.('LicenseCommercializationSnapshotStore load failed', error);
                        this.snapshots = [];
                        return this.getSnapshots();
                    });
            } else {
                this.applyLoadedSnapshots(loaded);
                this.readyPromise = Promise.resolve(this.getSnapshots());
            }
        } catch (error) {
            console?.warn?.('LicenseCommercializationSnapshotStore load failed', error);
            this.snapshots = [];
            this.readyPromise = Promise.resolve(this.getSnapshots());
        }
    }

    applyLoadedSnapshots(loaded) {
        if (!Array.isArray(loaded)) {
            return;
        }

        this.snapshots = loaded
            .map(normalizeSnapshot)
            .filter(Boolean)
            .sort((a, b) => new Date(b.capturedAt).getTime() - new Date(a.capturedAt).getTime())
            .slice(0, this.maxSnapshots);
    }
}

export function createInMemoryCommercializationSnapshotStorage(initial = []) {
    let data = Array.isArray(initial) ? initial.slice() : [];
    return {
        loadSnapshots() {
            return data.slice();
        },
        saveSnapshots(snapshots) {
            data = Array.isArray(snapshots) ? snapshots.slice() : [];
        }
    };
}
