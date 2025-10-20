import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import {
  generateLocalizationArtifacts,
  writeLocalizationArtifacts
} from '../codegen/localization-quaternions.ts';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

const MIN_NODE_VERSION = { major: 18, minor: 19 } as const;

function parseVersion(version: string): { major: number; minor: number } {
  const [major, minor] = version.split('.').map(part => Number.parseInt(part, 10));
  return { major, minor: Number.isFinite(minor) ? minor : 0 };
}

export function assertNodeVersion(version: string = process.versions.node): void {
  const { major, minor } = parseVersion(version);
  if (Number.isNaN(major) || major < MIN_NODE_VERSION.major) {
    throw new Error(`Node.js ${MIN_NODE_VERSION.major}.${MIN_NODE_VERSION.minor}+ is required. Detected ${version}`);
  }

  if (major === MIN_NODE_VERSION.major && minor < MIN_NODE_VERSION.minor) {
    throw new Error(`Node.js ${MIN_NODE_VERSION.major}.${MIN_NODE_VERSION.minor}+ is required. Detected ${version}`);
  }
}

function normalize(value: string): string {
  return value.replace(/\r\n/g, '\n');
}

export interface VerifyLocalizationArtifactsOptions {
  readonly rootDir?: string;
  readonly fix?: boolean;
}

export interface VerifyLocalizationArtifactsResult {
  readonly outputDir: string;
  readonly changed: readonly string[];
}

export async function verifyLocalizationArtifacts(
  options: VerifyLocalizationArtifactsOptions = {}
): Promise<VerifyLocalizationArtifactsResult> {
  const rootDir = options.rootDir ?? ROOT;
  const outputDir = path.join(rootDir, 'generated', 'localization');
  const artifacts = generateLocalizationArtifacts();
  const expectedFiles: Array<[string, string]> = [
    ['localization-uniform.ts', artifacts.typescript],
    ['localization-uniform.wgsl', artifacts.wgsl],
    ['LocalizationUniform.cs', artifacts.csharp],
    ['README.md', artifacts.readme]
  ];

  const changed: string[] = [];

  await Promise.all(
    expectedFiles.map(async ([filename, expected]) => {
      const targetPath = path.join(outputDir, filename);
      try {
        const actual = await fs.readFile(targetPath, 'utf8');
        if (normalize(actual) !== normalize(expected)) {
          changed.push(filename);
        }
      } catch (error: any) {
        if (error && error.code === 'ENOENT') {
          changed.push(filename);
          return;
        }
        throw error;
      }
    })
  );

  if (changed.length > 0 && options.fix) {
    await writeLocalizationArtifacts(outputDir);
    return { outputDir, changed };
  }

  if (changed.length > 0) {
    throw new Error(
      `Localization artifacts are out of date (${changed.join(', ')}). Run \`pnpm codegen:localization\` to regenerate.`
    );
  }

  return { outputDir, changed };
}

export async function runPreflight(command: string = process.argv[2] ?? 'script'): Promise<void> {
  assertNodeVersion();
  await verifyLocalizationArtifacts();
  // eslint-disable-next-line no-console
  console.log(`[preflight] ${command} checks passed.`);
}

const isCli = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isCli) {
  runPreflight().catch(error => {
    // eslint-disable-next-line no-console
    console.error('[preflight] validation failed:', error);
    process.exitCode = 1;
  });
}
