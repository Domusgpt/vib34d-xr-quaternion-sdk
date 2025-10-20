import { describe, it, expect, vi } from 'vitest';
import { LicenseCommercializationSnapshotStore, createInMemoryCommercializationSnapshotStorage } from '../src/product/licensing/LicenseCommercializationSnapshotStore.js';
import { createCommercializationSnapshotRemoteStorage } from '../src/product/licensing/storage/CommercializationSnapshotStorageAdapters.js';

describe('LicenseCommercializationSnapshotStore', () => {
  it('hydrates from asynchronous storage and sorts snapshots', async () => {
    const loadSnapshots = vi.fn(() => Promise.resolve([
      { id: 'old', capturedAt: '2024-01-01T00:00:00.000Z', summary: {}, context: {}, kpis: {} },
      { id: 'new', capturedAt: '2024-01-02T00:00:00.000Z', summary: {}, context: {}, kpis: {} },
    ]));
    const saveSnapshots = vi.fn();
    const appendSnapshot = vi.fn();

    const store = new LicenseCommercializationSnapshotStore({
      storage: {
        loadSnapshots,
        saveSnapshots,
        appendSnapshot,
      },
    });

    await store.whenReady();
    const snapshots = store.getSnapshots();
    expect(loadSnapshots).toHaveBeenCalled();
    expect(snapshots.map(snapshot => snapshot.id)).toEqual(['new', 'old']);
  });

  it('persists snapshots to storage adapters and exposes KPI reports', () => {
    const storage = createInMemoryCommercializationSnapshotStorage();
    const store = new LicenseCommercializationSnapshotStore({ storage });

    const summary = {
      packs: [{ id: 'pack-1', adoptionCount: 2, profileIds: ['profile-1'] }],
      profiles: [{ id: 'profile-1', adoptionCount: 2 }],
      segments: {},
      regions: {},
      defaultProfileId: 'profile-1',
      lastUpdated: new Date().toISOString(),
    };

    const snapshot = store.recordSnapshot(summary, { region: 'na', licenseKey: 'keep-local' });
    expect(snapshot.id).toBeDefined();
    expect(store.getSnapshots()).toHaveLength(1);

    const report = store.getKpiReport();
    expect(report.latest?.kpis.totalProfiles).toBe(1);
    expect(report.latest?.context.region).toBe('na');
  });
});

describe('Commercialization snapshot remote storage', () => {
  it('redacts license keys and normalizes snapshots before writing', async () => {
    const write = vi.fn();
    const read = vi.fn(() => [
      { id: 'remote', capturedAt: '2024-01-03T00:00:00.000Z', context: { licenseKey: 'abc', region: 'emea' }, summary: {}, kpis: {} },
    ]);

    const storage = createCommercializationSnapshotRemoteStorage({
      adapter: { write, read },
    });

    await storage.saveSnapshots([
      { id: 'local', capturedAt: '2024-01-04T00:00:00.000Z', context: { licenseKey: 'secret', region: 'na' }, summary: {}, kpis: {} },
    ]);

    expect(write).toHaveBeenCalled();
    const payload = write.mock.calls[0][0];
    expect(payload[0].context.licenseKey).toBeUndefined();
    expect(payload[0].context.region).toBe('na');

    const loaded = await storage.loadSnapshots();
    expect(Array.isArray(loaded)).toBe(true);
    expect(loaded[0].context.licenseKey).toBeUndefined();
  });
});
