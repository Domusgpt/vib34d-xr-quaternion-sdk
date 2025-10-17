import { promises as fs } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const positional = [];
const flags = new Set();
for (const arg of args) {
  if (arg.startsWith('--')) {
    flags.add(arg);
  } else {
    positional.push(arg);
  }
}

const distDir = positional[0] ?? 'dist-ci';
const cleanup = flags.has('--cleanup');
const thresholdKb = Number(process.env.BUNDLE_SIZE_THRESHOLD_KB ?? '220');

if (!Number.isFinite(thresholdKb) || thresholdKb <= 0) {
  console.warn('[bundleSizeCheck] Invalid BUNDLE_SIZE_THRESHOLD_KB env value, defaulting to 220KB.');
}

const trackedExtensions = new Set(['.js', '.mjs', '.cjs', '.ts', '.css', '.wasm', '.json']);

async function listFilesRecursive(rootDir) {
  const entries = await fs.readdir(rootDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(fullPath));
    } else {
      files.push(fullPath);
    }
  }
  return files;
}

function formatKb(bytes) {
  return `${(bytes / 1024).toFixed(2)}KB`;
}

(async () => {
  try {
    await fs.access(distDir);
  } catch (error) {
    console.error(`[bundleSizeCheck] Directory "${distDir}" not found. Did you run the build first?`);
    process.exitCode = 1;
    return;
  }

  const files = await listFilesRecursive(distDir);
  const assets = [];
  let totalBytes = 0;

  for (const file of files) {
    const ext = path.extname(file);
    if (!trackedExtensions.has(ext)) {
      continue;
    }
    const stats = await fs.stat(file);
    assets.push({ file, bytes: stats.size });
    totalBytes += stats.size;
  }

  assets.sort((a, b) => b.bytes - a.bytes);
  const thresholdBytes = thresholdKb * 1024;

  console.log(`[bundleSizeCheck] Evaluating ${assets.length} assets in ${distDir}.`);
  for (const asset of assets) {
    const relative = path.relative(process.cwd(), asset.file);
    console.log(`  - ${relative}: ${formatKb(asset.bytes)}`);
  }
  console.log(`[bundleSizeCheck] Total tracked size: ${formatKb(totalBytes)} (threshold ${thresholdKb}KB).`);

  if (totalBytes > thresholdBytes) {
    console.error('[bundleSizeCheck] Bundle exceeds allowed size threshold.');
    process.exitCode = 1;
  }

  if (cleanup) {
    await fs.rm(distDir, { recursive: true, force: true });
    console.log(`[bundleSizeCheck] Removed ${distDir} after evaluation.`);
  }
})();
