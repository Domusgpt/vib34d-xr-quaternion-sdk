import path from 'path';
import { fileURLToPath } from 'url';

import { writeLocalizationArtifacts } from '../codegen/localization-quaternions.ts';
import { assertNodeVersion, verifyLocalizationArtifacts } from './preflight.ts';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

export async function runLocalizationCodegen(): Promise<void> {
  assertNodeVersion();
  const outputDir = path.join(ROOT, 'generated', 'localization');
  await writeLocalizationArtifacts(outputDir);
  await verifyLocalizationArtifacts({ rootDir: ROOT });
  // eslint-disable-next-line no-console
  console.log(`[codegen] localization artifacts refreshed at ${outputDir}`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  runLocalizationCodegen().catch(error => {
    // eslint-disable-next-line no-console
    console.error('[codegen] localization generation failed:', error);
    process.exitCode = 1;
  });
}
