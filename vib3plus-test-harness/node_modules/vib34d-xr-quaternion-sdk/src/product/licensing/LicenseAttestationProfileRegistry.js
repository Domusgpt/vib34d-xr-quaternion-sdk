import { RemoteLicenseAttestor } from './RemoteLicenseAttestor.js';

function isObject(value) {
    return value !== null && typeof value === 'object';
}

function cloneShallow(value) {
    if (Array.isArray(value)) {
        return value.map(item => (isObject(item) ? { ...item } : item));
    }
    if (isObject(value)) {
        return { ...value };
    }
    return value;
}

export class LicenseAttestationProfileRegistry {
    constructor(options = {}) {
        this.profiles = new Map();
        this.defaultProfileId = options.defaultProfileId || null;
    }

    hasProfile(id) {
        return this.profiles.has(id);
    }

    registerProfile(profileOrId, maybeProfile) {
        const profile = this.normalizeProfile(profileOrId, maybeProfile);
        this.profiles.set(profile.id, profile);
        if (!this.defaultProfileId) {
            this.defaultProfileId = profile.id;
        }
        return this.getProfile(profile.id);
    }

    registerProfiles(profiles) {
        if (!Array.isArray(profiles)) return [];
        return profiles.map(profile => this.registerProfile(profile));
    }

    setDefaultProfile(id) {
        if (!this.profiles.has(id)) {
            throw new Error(`Unknown license attestation profile: ${id}`);
        }
        this.defaultProfileId = id;
    }

    getDefaultProfileId() {
        return this.defaultProfileId;
    }

    clearDefaultProfile() {
        this.defaultProfileId = null;
    }

    getProfile(id) {
        if (!this.profiles.has(id)) {
            return null;
        }
        const stored = this.profiles.get(id);
        return {
            id: stored.id,
            name: stored.name,
            description: stored.description,
            attestor: stored.attestor,
            createAttestor: stored.createAttestor,
            binding: stored.binding ? { ...stored.binding } : undefined,
            sla: stored.sla ? { ...stored.sla } : undefined,
            metadata: stored.metadata ? { ...stored.metadata } : undefined
        };
    }

    getProfiles() {
        return Array.from(this.profiles.keys()).map(id => this.getProfile(id));
    }

    removeProfile(id) {
        this.profiles.delete(id);
        if (this.defaultProfileId === id) {
            this.defaultProfileId = this.profiles.size > 0 ? this.profiles.keys().next().value : null;
        }
    }

    normalizeProfile(profileOrId, maybeProfile) {
        let profile;
        if (typeof profileOrId === 'string') {
            if (!maybeProfile || !isObject(maybeProfile)) {
                throw new Error('License attestation profile options are required.');
            }
            profile = { id: profileOrId, ...maybeProfile };
        } else if (isObject(profileOrId)) {
            profile = { ...profileOrId };
        } else {
            throw new Error('Invalid license attestation profile.');
        }

        if (!profile.id || typeof profile.id !== 'string') {
            throw new Error('License attestation profile must include an id.');
        }

        const normalized = {
            id: profile.id,
            name: typeof profile.name === 'string' ? profile.name : profile.id,
            description: typeof profile.description === 'string' ? profile.description : '',
            attestor: profile.attestor || null,
            createAttestor: typeof profile.createAttestor === 'function' ? profile.createAttestor : null,
            binding: profile.binding ? { ...profile.binding } : undefined,
            sla: profile.sla ? { ...profile.sla } : undefined,
            metadata: profile.metadata ? { ...profile.metadata } : undefined
        };

        if (!normalized.attestor && !normalized.createAttestor) {
            throw new Error(`License attestation profile "${normalized.id}" requires an attestor definition.`);
        }

        return normalized;
    }

    resolveProfileId(profileId) {
        const targetId = profileId || this.defaultProfileId;
        if (!targetId) {
            throw new Error('No license attestation profile id provided and no default set.');
        }
        if (!this.profiles.has(targetId)) {
            throw new Error(`Unknown license attestation profile: ${targetId}`);
        }
        return targetId;
    }

    createAttestor(profileId, overrides = {}) {
        const resolvedId = this.resolveProfileId(profileId);
        const stored = this.profiles.get(resolvedId);

        let attestorInstance = overrides.attestor || null;
        const attestorOptionsOverride = overrides.attestorOptions || {};

        if (!attestorInstance) {
            if (stored.createAttestor) {
                const result = stored.createAttestor({
                    profile: this.getProfile(resolvedId),
                    attestorOptions: attestorOptionsOverride,
                    overrides
                });
                if (!result) {
                    throw new Error(`createAttestor for profile "${resolvedId}" returned no attestor.`);
                }
                attestorInstance = result;
            } else if (stored.attestor && (typeof stored.attestor.createValidator === 'function' || typeof stored.attestor.bindToLicenseManager === 'function')) {
                attestorInstance = stored.attestor;
            } else if (stored.attestor && isObject(stored.attestor)) {
                const attestorConfig = { ...stored.attestor, ...attestorOptionsOverride };
                attestorInstance = new RemoteLicenseAttestor(attestorConfig);
            } else {
                throw new Error(`Profile "${resolvedId}" does not include a valid attestor configuration.`);
            }
        }

        const bindingOverrides = overrides.binding || {};
        const binding = stored.binding ? { ...stored.binding } : {};

        if (binding.attestorOptions || bindingOverrides.attestorOptions) {
            binding.attestorOptions = {
                ...(binding.attestorOptions ? cloneShallow(binding.attestorOptions) : {}),
                ...(bindingOverrides.attestorOptions ? cloneShallow(bindingOverrides.attestorOptions) : {})
            };
        }

        for (const [key, value] of Object.entries(bindingOverrides)) {
            if (key === 'attestorOptions') continue;
            binding[key] = value;
        }

        let metadata = stored.metadata ? { ...stored.metadata } : undefined;
        if (overrides.metadata) {
            metadata = { ...(metadata || {}), ...overrides.metadata };
        }

        const profile = this.getProfile(resolvedId);
        if (metadata) {
            profile.metadata = metadata;
        }

        return {
            attestor: attestorInstance,
            binding,
            profile
        };
    }
}
