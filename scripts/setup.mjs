#!/usr/bin/env node
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');

function log(message, detail) {
    if (detail) {
        console.log(`\u2022 ${message}`, detail);
    } else {
        console.log(`\u2022 ${message}`);
    }
}

function ensureNodeVersion() {
    const nvmrcPath = path.join(repoRoot, '.nvmrc');
    if (!existsSync(nvmrcPath)) {
        log('No .nvmrc detected – skipping Node.js version enforcement.');
        return;
    }

    const targetVersion = readFileSync(nvmrcPath, 'utf8').trim();
    if (!targetVersion) {
        log('Unable to determine Node.js version from .nvmrc.');
        return;
    }

    const current = process.version.replace(/^v/, '');
    if (!current.startsWith(targetVersion)) {
        log('Node.js version mismatch detected.', {
            expected: targetVersion,
            current: process.version
        });
        log('Use `nvm use` (or manually switch) before continuing.');
    } else {
        log(`Node.js ${current} satisfies .nvmrc requirement.`);
    }
}

function ensureDependencies() {
    const nodeModulesPath = path.join(repoRoot, 'node_modules');
    if (existsSync(nodeModulesPath)) {
        log('Dependencies already installed – skipping `npm install`.');
        return;
    }

    log('Installing npm dependencies...');
    const result = spawnSync('npm', ['install'], {
        cwd: repoRoot,
        stdio: 'inherit',
        env: {
            ...process.env,
            VIB34D_SETUP: 'true'
        }
    });

    if (result.status !== 0) {
        console.error('`npm install` failed. See output above for details.');
        process.exit(result.status ?? 1);
    }
}

function summarizeNextSteps() {
    console.log('\nNext steps:');
    log('Connect an XR device emulator or headset for runtime testing.');
    log('Review DOCS/ENVIRONMENT_AND_DEVELOPMENT_TRACK.md for the phased roadmap.');
}

ensureNodeVersion();
ensureDependencies();
summarizeNextSteps();
