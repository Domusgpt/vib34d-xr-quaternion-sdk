# Adaptive Engine Testing Stack Evaluation

## Goals
- Provide automated coverage for the adaptive pipeline without exceeding lightweight container limits.
- Maintain compatibility with headless CI providers and partner SDK contributors.
- Support future visual regression checks for projection-based interfaces.

## Options Assessed

### 1. Vitest + jsdom
- **Pros:**
  - Lightweight dependency footprint; no system-level browser binaries required.
  - Fast feedback loop for unit tests covering `SensoryInputBridge`, layout strategies, and telemetry providers.
  - Built-in mocking utilities suitable for sensor stream simulations.
- **Cons:**
  - Limited fidelity for actual rendering or 4D projection previews.
  - Requires manual wiring for accessibility or visual assertions.
- **Use Cases:** Core unit/integration coverage for modularized layout/telemetry logic; contract tests for SDK APIs.

### 2. Playwright (current default)
- **Pros:**
  - High-fidelity browser automation for demo shells and partner plug-in prototypes.
  - Supports screenshot baselines and cross-browser compatibility testing.
- **Cons:**
  - Installation requires ~500 MB of OS packages (`npx playwright install-deps`) which exceeds current container constraints.
  - Slower execution; overkill for logic-focused modules pre-UI hardening.
- **Use Cases:** Targeted smoke suites once SDK stabilizes and CI environment accommodates heavier dependencies.

### 3. WebdriverIO + Chromium Snapshot
- **Pros:**
  - Configurable to use system Chromium already present in some CI images.
  - Plugin ecosystem for visual diffing.
- **Cons:**
  - More configuration overhead; duplicates effort if we eventually standardize on Playwright.
  - Still requires maintaining browser binaries for deterministic runs.
- **Use Cases:** Backup option if Playwright licensing or footprint remains unresolved.

## Recommendation
1. **Adopt Vitest + jsdom as the primary test runner for Phase 1** to unlock unit coverage of modular strategies and providers without waiting on OS-level dependencies.
2. **Retain Playwright tooling in the repo but mark it optional** until we have an approved container image or CI tier that bundles the required packages.

## Implementation Status (2025-10-09 Update)
- Vitest + jsdom dependencies added to `package.json`; configuration lives in `vitest.config.js`.
- Baseline suites cover `SpatialLayoutSynthesizer` and `ProductTelemetryHarness` under `tests/vitest/`.
- Playwright scripts remain callable via `npm run test:e2e*`; browser installation is still deferred pending blocker B-07.
3. **Document a staged testing strategy**: unit (Vitest), contract (Vitest + lightweight DOM), high-fidelity (Playwright/manual) so partners understand expectation levels.

## Next Steps
- Add Vitest, jsdom, and supporting typings to `package.json` devDependencies.
- Draft initial test skeletons for `SpatialLayoutSynthesizer` strategies and `TelemetryProvider` registry.
- Update the development tracker environment checklist to reflect the two-tier testing plan and unblock B-07 decision.
