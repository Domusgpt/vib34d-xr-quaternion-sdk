function cloneMetadata(value) {
    if (!value || typeof value !== 'object') {
        return undefined;
    }
    return JSON.parse(JSON.stringify(value));
}

function normalizeProfile(profile) {
    if (!profile) return null;
    return {
        id: profile.id,
        name: profile.name,
        description: profile.description,
        metadata: cloneMetadata(profile.metadata),
        sla: profile.sla ? { ...profile.sla } : undefined
    };
}

function extractProfilesFromPack(pack) {
    if (!pack || !Array.isArray(pack.profiles)) {
        return [];
    }
    return pack.profiles.map(normalizeProfile).filter(Boolean);
}

function toIso(timestamp) {
    return timestamp ? new Date(timestamp).toISOString() : null;
}

function parseAvailability(value) {
    if (typeof value === 'number') return value;
    if (typeof value !== 'string') return null;
    const numeric = parseFloat(value.replace(/%/g, ''));
    return Number.isFinite(numeric) ? numeric : null;
}

function aggregateMetric(values) {
    const filtered = values.filter(value => typeof value === 'number' && !Number.isNaN(value));
    if (filtered.length === 0) return null;
    const min = Math.min(...filtered);
    const max = Math.max(...filtered);
    const average = filtered.reduce((sum, value) => sum + value, 0) / filtered.length;
    return { min, max, average };
}

function ensureSet(map, key) {
    if (!map.has(key)) {
        map.set(key, new Set());
    }
    return map.get(key);
}

export class LicenseCommercializationReporter {
    constructor(options = {}) {
        this.packs = new Map();
        this.profiles = new Map();
        this.profileToPack = new Map();
        this.adoption = new Map();
        this.defaultProfileId = null;
        this.lastUpdated = null;
        this.updateListeners = [];
        if (typeof options.onUpdate === 'function') {
            this.addUpdateListener(options.onUpdate);
        }
        this.emitProfileDetails = options.emitProfileDetails ?? true;
    }

    touch() {
        this.lastUpdated = new Date();
        const summary = this.getSummary();
        for (const listener of this.updateListeners) {
            try {
                listener(summary);
            } catch (error) {
                console?.warn?.('LicenseCommercializationReporter onUpdate failed', error);
            }
        }
    }

    addUpdateListener(listener) {
        if (typeof listener !== 'function') {
            throw new Error('LicenseCommercializationReporter update listener must be a function.');
        }
        this.updateListeners.push(listener);
        return () => this.removeUpdateListener(listener);
    }

    removeUpdateListener(listener) {
        const index = this.updateListeners.indexOf(listener);
        if (index >= 0) {
            this.updateListeners.splice(index, 1);
        }
    }

    recordPackRegistration(pack, context = {}) {
        if (!pack) return;
        const profiles = extractProfilesFromPack(pack);
        const entry = {
            id: pack.id,
            name: pack.name,
            description: pack.description,
            metadata: cloneMetadata(pack.metadata),
            profileIds: new Set(profiles.map(profile => profile.id)),
            registeredAt: new Date(),
            appliedDefault: context.appliedDefault ?? (pack.defaultProfileId ? context.applyDefault !== false : false),
            defaultProfileId: context.defaultProfileId ?? pack.defaultProfileId ?? null,
            options: cloneMetadata(context.options)
        };
        this.packs.set(entry.id, entry);
        if (entry.defaultProfileId) {
            this.defaultProfileId = entry.defaultProfileId;
        }
        for (const profile of profiles) {
            this.profileToPack.set(profile.id, entry.id);
        }
        if (Array.isArray(context.registeredProfileIds)) {
            for (const profileId of context.registeredProfileIds) {
                this.profileToPack.set(profileId, entry.id);
            }
        }
        this.touch();
    }

    recordProfileRegistration(profile, context = {}) {
        const normalized = normalizeProfile(profile);
        if (!normalized) return;
        const packId = context.packId || this.profileToPack.get(normalized.id) || null;
        const details = {
            profile: normalized,
            packId,
            registeredAt: new Date(),
            source: context.source || (packId ? 'catalog-pack' : 'direct'),
            metadata: cloneMetadata(context.metadata)
        };
        this.profiles.set(normalized.id, details);
        if (packId) {
            this.profileToPack.set(normalized.id, packId);
        }
        if (context.setAsDefault) {
            this.defaultProfileId = normalized.id;
        }
        this.touch();
    }

    recordProfileApplied(profile, context = {}) {
        const normalized = normalizeProfile(profile);
        if (!normalized) return;
        const packId = context.packId || this.profileToPack.get(normalized.id) || null;
        const adoption = this.adoption.get(normalized.id) || {
            count: 0,
            lastAppliedAt: null,
            history: []
        };
        adoption.count += 1;
        const appliedAt = new Date();
        adoption.lastAppliedAt = appliedAt;
        if (this.emitProfileDetails !== false) {
            adoption.history.push({
                at: appliedAt.toISOString(),
                packId,
                context: cloneMetadata(context.context)
            });
        }
        this.adoption.set(normalized.id, adoption);
        this.touch();
    }

    recordDefaultProfileChange(profileId, context = {}) {
        if (profileId) {
            this.defaultProfileId = profileId;
        } else {
            this.defaultProfileId = null;
        }
        const packId = profileId ? this.profileToPack.get(profileId) : null;
        if (packId && this.packs.has(packId)) {
            const pack = this.packs.get(packId);
            pack.defaultProfileId = profileId;
            this.packs.set(packId, pack);
        }
        if (context.packId && this.packs.has(context.packId)) {
            const pack = this.packs.get(context.packId);
            pack.defaultProfileId = profileId;
            this.packs.set(context.packId, pack);
        }
        this.touch();
    }

    getPackIdForProfile(profileId) {
        return this.profileToPack.get(profileId) || null;
    }

    getSummary() {
        const packs = [];
        for (const entry of this.packs.values()) {
            const adoptionCount = Array.from(entry.profileIds.values())
                .reduce((sum, profileId) => sum + (this.adoption.get(profileId)?.count || 0), 0);
            packs.push({
                id: entry.id,
                name: entry.name,
                description: entry.description,
                metadata: cloneMetadata(entry.metadata),
                profileIds: Array.from(entry.profileIds.values()),
                registeredAt: toIso(entry.registeredAt),
                appliedDefault: entry.appliedDefault,
                defaultProfileId: entry.defaultProfileId || null,
                adoptionCount,
                options: cloneMetadata(entry.options)
            });
        }

        const profiles = [];
        for (const [id, record] of this.profiles.entries()) {
            const adoption = this.adoption.get(id);
            profiles.push({
                id,
                name: record.profile.name,
                description: record.profile.description,
                metadata: cloneMetadata(record.profile.metadata),
                sla: record.profile.sla ? { ...record.profile.sla } : undefined,
                packId: record.packId || null,
                registeredAt: toIso(record.registeredAt),
                source: record.source,
                adoptionCount: adoption?.count || 0,
                lastAppliedAt: adoption?.lastAppliedAt ? adoption.lastAppliedAt.toISOString() : null
            });
        }

        const segments = new Map();
        const regions = new Map();
        const responseTargets = [];
        const availabilities = [];
        const breachWindows = [];

        for (const profile of profiles) {
            const metadata = profile.metadata || {};
            const segment = metadata.segment || 'unspecified';
            const region = metadata.region || 'global';
            const segmentEntry = ensureSet(segments, segment);
            segmentEntry.add(profile.id);
            const regionEntry = ensureSet(regions, region);
            regionEntry.add(profile.id);

            if (profile.sla) {
                if (typeof profile.sla.responseTargetMs === 'number') {
                    responseTargets.push(profile.sla.responseTargetMs);
                }
                if (typeof profile.sla.breachWindowMs === 'number') {
                    breachWindows.push(profile.sla.breachWindowMs);
                }
                const availability = parseAvailability(profile.sla.availability);
                if (availability !== null) {
                    availabilities.push(availability);
                }
            }
        }

        const segmentSummary = {};
        for (const [segment, ids] of segments.entries()) {
            segmentSummary[segment] = {
                profileCount: ids.size,
                packIds: Array.from(new Set(Array.from(ids.values()).map(id => this.profileToPack.get(id) || null).filter(Boolean))),
                adoptionCount: Array.from(ids.values()).reduce((sum, id) => sum + (this.adoption.get(id)?.count || 0), 0)
            };
        }

        const regionSummary = {};
        for (const [region, ids] of regions.entries()) {
            regionSummary[region] = {
                profileCount: ids.size,
                adoptionCount: Array.from(ids.values()).reduce((sum, id) => sum + (this.adoption.get(id)?.count || 0), 0)
            };
        }

        const sla = {
            responseTargetMs: aggregateMetric(responseTargets),
            availabilityPercent: aggregateMetric(availabilities),
            breachWindowMs: aggregateMetric(breachWindows)
        };

        return {
            packs,
            profiles,
            segments: segmentSummary,
            regions: regionSummary,
            sla,
            defaultProfileId: this.defaultProfileId,
            lastUpdated: this.lastUpdated ? this.lastUpdated.toISOString() : null
        };
    }
}
