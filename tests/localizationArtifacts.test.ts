import { describe, expect, it } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';

import { generateLocalizationArtifacts } from '../tools/codegen/localization-quaternions.ts';
import { verifyLocalizationArtifacts } from '../tools/scripts/preflight.ts';

const ROOT = path.resolve(fileURLToPath(new URL('..', import.meta.url)));

describe('localization code generation artifacts', () => {
  it('emit deterministic outputs and stay in sync with the repository', async () => {
    const artifacts = generateLocalizationArtifacts();

    expect(artifacts.typescript).toContain('LocalizationReliabilityLevel');
    expect(artifacts.wgsl).toContain('struct LocalizationUniform');
    expect(artifacts.csharp).toContain('struct LocalizationUniformCSharp');
    expect(artifacts.readme).toContain('Generated localization uniform schema');

    const verification = await verifyLocalizationArtifacts({ rootDir: ROOT });
    expect(verification.changed).toHaveLength(0);
  });
});
