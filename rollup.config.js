import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';

const banner = `/**
 * VIB34D XR Quaternion SDK
 * 4D Geometric Processing with XR Quaternion Integration
 * @version 1.0.0
 * @author Paul Phillips <Paul@clearseassolutions.com>
 * @license SEE LICENSE IN DOCS/LICENSE_ATTESTATION_PROFILE_CATALOG.md
 */`;

export default [
  // ESM build (for modern bundlers)
  {
    input: 'src/core/AdaptiveSDK.js',
    output: {
      file: 'dist/adaptive-sdk.esm.js',
      format: 'es',
      banner,
      sourcemap: true,
    },
    plugins: [
      resolve(),
      commonjs(),
    ],
  },

  // CommonJS build (for Node.js)
  {
    input: 'src/core/AdaptiveSDK.js',
    output: {
      file: 'dist/adaptive-sdk.cjs',
      format: 'cjs',
      banner,
      sourcemap: true,
      exports: 'named',
    },
    plugins: [
      resolve(),
      commonjs(),
    ],
  },

  // UMD build (for browsers via script tag)
  {
    input: 'src/core/AdaptiveSDK.js',
    output: {
      file: 'dist/adaptive-sdk.umd.js',
      format: 'umd',
      name: 'VIB34D',
      banner,
      sourcemap: true,
    },
    plugins: [
      resolve(),
      commonjs(),
    ],
  },

  // Minified UMD build (for production)
  {
    input: 'src/core/AdaptiveSDK.js',
    output: {
      file: 'dist/adaptive-sdk.umd.min.js',
      format: 'umd',
      name: 'VIB34D',
      banner,
      sourcemap: true,
    },
    plugins: [
      resolve(),
      commonjs(),
      terser({
        format: {
          comments: /^!/,
          preamble: banner,
        },
      }),
    ],
  },
];
