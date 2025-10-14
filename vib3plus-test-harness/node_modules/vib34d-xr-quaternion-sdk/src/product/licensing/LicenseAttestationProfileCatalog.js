import { RemoteLicenseAttestor } from './RemoteLicenseAttestor.js';

function ensureArray(value, fallback) {
    if (Array.isArray(value) && value.length > 0) {
        return value;
    }
    return Array.isArray(fallback) ? [...fallback] : [];
}

function trimTrailingSlash(value) {
    if (typeof value !== 'string') return '';
    return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizeRegion(region) {
    if (!region) return 'global';
    return String(region).toLowerCase();
}

function toDisplayRegion(region) {
    if (!region) return 'Global';
    return region.split('-').map(part => part.charAt(0).toUpperCase() + part.slice(1)).join(' ');
}

function cloneProfile(profile) {
    return {
        ...profile,
        attestor: profile.attestor ? { ...profile.attestor } : undefined,
        binding: profile.binding ? { ...profile.binding } : undefined,
        sla: profile.sla ? { ...profile.sla } : undefined,
        metadata: profile.metadata ? { ...profile.metadata } : undefined
    };
}

const ENTERPRISE_SAAS_PACK = {
    id: 'enterprise-saas',
    name: 'Enterprise SaaS Compliance Pack',
    description: 'Hardened attestation endpoints for regulated enterprise customers with multi-region redundancy.',
    defaults: {
        baseUrl: 'https://licensing.enterprise.example.com',
        regions: ['global', 'na', 'eu'],
        pollIntervalMs: 15 * 60 * 1000,
        minimumPollIntervalMs: 5 * 60 * 1000,
        failOpen: false,
        headers: {
            'x-sdk-product': 'adaptive-interface-engine',
            'x-sdk-tier': 'enterprise'
        },
        sla: {
            responseTargetMs: 900,
            availability: '99.9%',
            breachWindowMs: 5 * 60 * 1000
        }
    },
    buildProfiles(options = {}) {
        const regions = ensureArray(options.regions, this.defaults.regions);
        const baseUrl = trimTrailingSlash(options.baseUrl || this.defaults.baseUrl);
        return regions.map(region => {
            const normalized = normalizeRegion(region);
            const displayRegion = toDisplayRegion(normalized);
            const regionPath = normalized === 'global' ? 'global' : normalized;
            const attestationBase = `${baseUrl}/${regionPath}`;

            return {
                id: `enterprise-saas/${normalized}`,
                name: `Enterprise SaaS (${displayRegion})`,
                description: `Managed compliance endpoints for ${displayRegion} deployments.`,
                attestor: {
                    attestationUrl: `${attestationBase}/attest`,
                    revocationUrl: `${attestationBase}/revoke`,
                    entitlementsUrl: `${attestationBase}/entitlements`,
                    pollIntervalMs: options.pollIntervalMs ?? this.defaults.pollIntervalMs,
                    minimumPollIntervalMs: options.minimumPollIntervalMs ?? this.defaults.minimumPollIntervalMs,
                    failOpen: options.failOpen ?? this.defaults.failOpen,
                    headers: { ...this.defaults.headers, ...(options.headers || {}) }
                },
                binding: {
                    attestorOptions: {
                        context: {
                            region: normalized,
                            tier: 'enterprise'
                        }
                    }
                },
                sla: {
                    responseTargetMs: options.sla?.responseTargetMs ?? this.defaults.sla.responseTargetMs,
                    availability: options.sla?.availability ?? this.defaults.sla.availability,
                    breachWindowMs: options.sla?.breachWindowMs ?? this.defaults.sla.breachWindowMs
                },
                metadata: {
                    segment: 'enterprise',
                    region: normalized,
                    complianceTier: 'regulated'
                }
            };
        });
    }
};

const STUDIO_COLLAB_PACK = {
    id: 'studio-collab',
    name: 'Studio Collaboration Pack',
    description: 'Right-sized attestation endpoints for design studios collaborating across wearable projects.',
    defaults: {
        baseUrl: 'https://licensing.studiohub.example.com',
        regions: ['global', 'latam'],
        pollIntervalMs: 30 * 60 * 1000,
        minimumPollIntervalMs: 10 * 60 * 1000,
        failOpen: true,
        headers: {
            'x-sdk-product': 'adaptive-interface-engine',
            'x-sdk-tier': 'studio'
        },
        sla: {
            responseTargetMs: 1500,
            availability: '99.5%',
            breachWindowMs: 15 * 60 * 1000
        }
    },
    buildProfiles(options = {}) {
        const regions = ensureArray(options.regions, this.defaults.regions);
        const baseUrl = trimTrailingSlash(options.baseUrl || this.defaults.baseUrl);
        const collaborationId = options.collaborationId || 'default';

        return regions.map(region => {
            const normalized = normalizeRegion(region);
            const displayRegion = toDisplayRegion(normalized);
            const regionPath = normalized === 'global' ? 'global' : normalized;
            const attestationBase = `${baseUrl}/${collaborationId}/${regionPath}`;

            return {
                id: `studio-collab/${collaborationId}/${normalized}`,
                name: `Studio Collaboration (${displayRegion})`,
                description: `Shared entitlement attestation for ${displayRegion} studio pods (${collaborationId}).`,
                attestor: {
                    attestationUrl: `${attestationBase}/attest`,
                    revocationUrl: `${attestationBase}/revoke`,
                    entitlementsUrl: `${attestationBase}/entitlements`,
                    pollIntervalMs: options.pollIntervalMs ?? this.defaults.pollIntervalMs,
                    minimumPollIntervalMs: options.minimumPollIntervalMs ?? this.defaults.minimumPollIntervalMs,
                    failOpen: options.failOpen ?? this.defaults.failOpen,
                    headers: { ...this.defaults.headers, ...(options.headers || {}), 'x-collaboration-id': collaborationId }
                },
                binding: {
                    attestorOptions: {
                        context: {
                            region: normalized,
                            collaborationId,
                            tier: 'studio'
                        }
                    }
                },
                sla: {
                    responseTargetMs: options.sla?.responseTargetMs ?? this.defaults.sla.responseTargetMs,
                    availability: options.sla?.availability ?? this.defaults.sla.availability,
                    breachWindowMs: options.sla?.breachWindowMs ?? this.defaults.sla.breachWindowMs
                },
                metadata: {
                    segment: 'studio',
                    region: normalized,
                    collaborationId,
                    complianceTier: 'managed'
                }
            };
        });
    }
};

const INDIE_LAB_PACK = {
    id: 'indie-lab',
    name: 'Indie Lab Starter Pack',
    description: 'Lightweight attestation endpoints for independent wearable labs and prototyping collectives.',
    defaults: {
        baseUrl: 'https://licensing.indielab.example.com',
        regions: ['global'],
        pollIntervalMs: 60 * 60 * 1000,
        minimumPollIntervalMs: 30 * 60 * 1000,
        failOpen: true,
        headers: {
            'x-sdk-product': 'adaptive-interface-engine',
            'x-sdk-tier': 'indie'
        },
        sla: {
            responseTargetMs: 2500,
            availability: '99.0%',
            breachWindowMs: 30 * 60 * 1000
        }
    },
    buildProfiles(options = {}) {
        const regions = ensureArray(options.regions, this.defaults.regions);
        const baseUrl = trimTrailingSlash(options.baseUrl || this.defaults.baseUrl);
        const projectCode = options.projectCode || 'prototype';

        return regions.map(region => {
            const normalized = normalizeRegion(region);
            const displayRegion = toDisplayRegion(normalized);
            const regionPath = normalized === 'global' ? 'global' : normalized;
            const attestationBase = `${baseUrl}/${projectCode}/${regionPath}`;

            return {
                id: `indie-lab/${projectCode}/${normalized}`,
                name: `Indie Lab (${displayRegion})`,
                description: `Low-friction attestation endpoints for ${projectCode} experiments in ${displayRegion}.`,
                attestor: {
                    attestationUrl: `${attestationBase}/attest`,
                    revocationUrl: `${attestationBase}/revoke`,
                    entitlementsUrl: `${attestationBase}/entitlements`,
                    pollIntervalMs: options.pollIntervalMs ?? this.defaults.pollIntervalMs,
                    minimumPollIntervalMs: options.minimumPollIntervalMs ?? this.defaults.minimumPollIntervalMs,
                    failOpen: options.failOpen ?? this.defaults.failOpen,
                    headers: { ...this.defaults.headers, ...(options.headers || {}), 'x-project-code': projectCode }
                },
                binding: {
                    attestorOptions: {
                        context: {
                            region: normalized,
                            projectCode,
                            tier: 'indie'
                        }
                    }
                },
                sla: {
                    responseTargetMs: options.sla?.responseTargetMs ?? this.defaults.sla.responseTargetMs,
                    availability: options.sla?.availability ?? this.defaults.sla.availability,
                    breachWindowMs: options.sla?.breachWindowMs ?? this.defaults.sla.breachWindowMs
                },
                metadata: {
                    segment: 'indie',
                    region: normalized,
                    projectCode,
                    complianceTier: 'experimental'
                }
            };
        });
    }
};

export const DEFAULT_LICENSE_ATTESTATION_PROFILE_PACKS = [
    ENTERPRISE_SAAS_PACK,
    STUDIO_COLLAB_PACK,
    INDIE_LAB_PACK
];

export function instantiateLicenseAttestationProfilePack(packDescriptor, options = {}) {
    if (!packDescriptor) {
        throw new Error('A license attestation profile pack descriptor is required.');
    }

    const packOptions = {
        ...(packDescriptor.defaults || {}),
        ...(options || {})
    };

    let profiles;
    if (typeof packDescriptor.buildProfiles === 'function') {
        profiles = packDescriptor.buildProfiles(packOptions) || [];
    } else if (Array.isArray(packDescriptor.profiles)) {
        profiles = packDescriptor.profiles.map(profile => cloneProfile(profile));
    } else {
        profiles = [];
    }

    profiles = profiles.map(profile => {
        if (profile.attestor && !(profile.attestor instanceof RemoteLicenseAttestor) && typeof profile.attestor === 'object') {
            return cloneProfile({
                ...profile,
                attestor: { ...profile.attestor }
            });
        }
        return cloneProfile(profile);
    });

    const defaultProfileId = packOptions.defaultProfileId
        || packDescriptor.defaultProfileId
        || (profiles[0] ? profiles[0].id : null);

    return {
        id: packDescriptor.id || options.id || 'custom-pack',
        name: packDescriptor.name || options.name || packDescriptor.id || 'Custom Pack',
        description: packDescriptor.description || options.description || '',
        metadata: packDescriptor.metadata ? { ...packDescriptor.metadata } : (options.metadata ? { ...options.metadata } : undefined),
        profiles,
        defaultProfileId
    };
}

export function resolveLicenseAttestationProfilePack(packOrId, options = {}) {
    if (typeof packOrId === 'string') {
        const descriptor = DEFAULT_LICENSE_ATTESTATION_PROFILE_PACKS.find(pack => pack.id === packOrId);
        if (!descriptor) {
            throw new Error(`Unknown license attestation profile pack: ${packOrId}`);
        }
        return instantiateLicenseAttestationProfilePack(descriptor, options);
    }

    if (packOrId && typeof packOrId === 'object') {
        if (typeof packOrId.buildProfiles === 'function' || Array.isArray(packOrId.profiles)) {
            return instantiateLicenseAttestationProfilePack(packOrId, options);
        }
        if (Array.isArray(packOrId.packages)) {
            throw new Error('Nested license attestation profile packs are not supported.');
        }
        if (Array.isArray(packOrId.regions) || packOrId.baseUrl) {
            return instantiateLicenseAttestationProfilePack({ ...ENTERPRISE_SAAS_PACK, ...packOrId }, options);
        }
    }

    throw new Error('Invalid license attestation profile pack supplied.');
}
