/**
 * VIB34D SDK Performance Benchmarks
 * Measures performance of critical SDK operations
 */

import { performance } from 'perf_hooks';

// Color output for terminal
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function formatTime(ms) {
  if (ms < 1) return `${(ms * 1000).toFixed(2)}μs`;
  if (ms < 1000) return `${ms.toFixed(2)}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
}

function benchmark(name, fn, iterations = 10000) {
  // Warmup
  for (let i = 0; i < 100; i++) fn();

  // Benchmark
  const start = performance.now();
  for (let i = 0; i < iterations; i++) {
    fn();
  }
  const end = performance.now();

  const totalTime = end - start;
  const avgTime = totalTime / iterations;

  return {
    name,
    totalTime,
    avgTime,
    iterations,
    opsPerSec: 1000 / avgTime,
  };
}

// Quaternion Operations
function benchmarkQuaternionOps() {
  log('\n🔮 Quaternion Operations', 'cyan');
  log('─'.repeat(60), 'cyan');

  const results = [];

  // Quaternion Creation
  results.push(benchmark('Quaternion Creation', () => {
    const q = { x: 1, y: 2, z: 3, w: 4 };
  }));

  // Quaternion Normalization
  results.push(benchmark('Quaternion Normalization', () => {
    const q = { x: 1, y: 2, z: 3, w: 4 };
    const mag = Math.sqrt(q.x ** 2 + q.y ** 2 + q.z ** 2 + q.w ** 2);
    const normalized = {
      x: q.x / mag,
      y: q.y / mag,
      z: q.z / mag,
      w: q.w / mag,
    };
  }));

  // Quaternion Multiplication
  results.push(benchmark('Quaternion Multiplication', () => {
    const q1 = { x: 1, y: 0, z: 0, w: 1 };
    const q2 = { x: 0, y: 1, z: 0, w: 1 };
    const result = {
      x: q1.w * q2.x + q1.x * q2.w + q1.y * q2.z - q1.z * q2.y,
      y: q1.w * q2.y - q1.x * q2.z + q1.y * q2.w + q1.z * q2.x,
      z: q1.w * q2.z + q1.x * q2.y - q1.y * q2.x + q1.z * q2.w,
      w: q1.w * q2.w - q1.x * q2.x - q1.y * q2.y - q1.z * q2.z,
    };
  }));

  // Axis-Angle to Quaternion
  results.push(benchmark('Axis-Angle to Quaternion', () => {
    const axis = { x: 0, y: 1, z: 0 };
    const angle = Math.PI / 4;
    const halfAngle = angle / 2;
    const s = Math.sin(halfAngle);
    const q = {
      x: axis.x * s,
      y: axis.y * s,
      z: axis.z * s,
      w: Math.cos(halfAngle),
    };
  }));

  printResults(results);
  return results;
}

// 4D Vector Operations
function benchmark4DVectorOps() {
  log('\n📐 4D Vector Operations', 'cyan');
  log('─'.repeat(60), 'cyan');

  const results = [];

  // 4D Vector Creation
  results.push(benchmark('4D Vector Creation', () => {
    const v = { x: 1, y: 2, z: 3, w: 4 };
  }));

  // 4D Vector Magnitude
  results.push(benchmark('4D Vector Magnitude', () => {
    const v = { x: 1, y: 2, z: 3, w: 4 };
    const mag = Math.sqrt(v.x ** 2 + v.y ** 2 + v.z ** 2 + v.w ** 2);
  }));

  // 4D to 3D Projection
  results.push(benchmark('4D to 3D Projection', () => {
    const v4 = { x: 1, y: 2, z: 3, w: 1 };
    const distance = 4;
    const divisor = distance - v4.w;
    const v3 = {
      x: v4.x / divisor,
      y: v4.y / divisor,
      z: v4.z / divisor,
    };
  }));

  // 4D Rotation (XW plane)
  results.push(benchmark('4D Rotation (XW plane)', () => {
    const v = { x: 1, y: 0, z: 0, w: 0 };
    const angle = Math.PI / 4;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const rotated = {
      x: v.x * cos - v.w * sin,
      y: v.y,
      z: v.z,
      w: v.x * sin + v.w * cos,
    };
  }));

  printResults(results);
  return results;
}

// Sensor Data Processing
function benchmarkSensorProcessing() {
  log('\n📡 Sensor Data Processing', 'cyan');
  log('─'.repeat(60), 'cyan');

  const results = [];

  // Sensor Data Normalization
  results.push(benchmark('Sensor Data Normalization', () => {
    const raw = {
      position: { x: 1.5, y: 2.3, z: -0.5 },
      orientation: { x: 0.1, y: 0.2, z: 0.3, w: 0.9 },
    };

    const mag = Math.sqrt(
      raw.orientation.x ** 2 + raw.orientation.y ** 2 +
      raw.orientation.z ** 2 + raw.orientation.w ** 2
    );

    const normalized = {
      position: raw.position,
      orientation: {
        x: raw.orientation.x / mag,
        y: raw.orientation.y / mag,
        z: raw.orientation.z / mag,
        w: raw.orientation.w / mag,
      },
    };
  }));

  // Multi-Sensor Fusion
  results.push(benchmark('Multi-Sensor Fusion', () => {
    const sensor1 = { value: 10, confidence: 0.9 };
    const sensor2 = { value: 12, confidence: 0.7 };

    const totalConf = sensor1.confidence + sensor2.confidence;
    const fused = (sensor1.value * sensor1.confidence +
                   sensor2.value * sensor2.confidence) / totalConf;
  }));

  // Confidence Decay
  results.push(benchmark('Confidence Decay Calculation', () => {
    const initialConf = 1.0;
    const decayRate = 0.95;
    const timeElapsed = 5;
    const decayed = initialConf * Math.pow(decayRate, timeElapsed);
  }));

  printResults(results);
  return results;
}

// Telemetry Operations
function benchmarkTelemetry() {
  log('\n📊 Telemetry Operations', 'cyan');
  log('─'.repeat(60), 'cyan');

  const results = [];

  // Event Creation
  results.push(benchmark('Event Creation', () => {
    const event = {
      category: 'user-action',
      action: 'button-click',
      timestamp: Date.now(),
      metadata: { userId: '123' },
    };
  }));

  // Event Batching
  results.push(benchmark('Event Batching (10 events)', () => {
    const batch = [];
    for (let i = 0; i < 10; i++) {
      batch.push({
        category: 'metric',
        action: 'frame-render',
        value: Math.random(),
        timestamp: Date.now(),
      });
    }
  }, 1000));

  // JSON Serialization
  results.push(benchmark('Event JSON Serialization', () => {
    const event = {
      category: 'user-action',
      action: 'export-blueprint',
      timestamp: Date.now(),
      metadata: { format: 'json', size: 1024 },
    };
    JSON.stringify(event);
  }));

  printResults(results);
  return results;
}

// License Operations
function benchmarkLicense() {
  log('\n🔐 License Operations', 'cyan');
  log('─'.repeat(60), 'cyan');

  const results = [];

  // License Validation
  results.push(benchmark('License Validation', () => {
    const license = {
      key: 'TEST-LICENSE-KEY',
      tier: 'enterprise',
      expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(),
      status: 'active',
    };

    const isValid =
      license.status === 'active' &&
      new Date(license.expiresAt) > new Date();
  }));

  // Feature Check
  results.push(benchmark('Feature Access Check', () => {
    const license = {
      features: ['telemetry', 'analytics', 'multi-device', 'custom-branding'],
    };

    const hasFeature = license.features.includes('analytics');
  }));

  printResults(results);
  return results;
}

// Print Results
function printResults(results) {
  results.forEach(result => {
    const color = result.avgTime < 0.01 ? 'green' :
                  result.avgTime < 0.1 ? 'yellow' : 'red';

    log(`  ${result.name}:`, 'bright');
    log(`    Average: ${formatTime(result.avgTime)}`, color);
    log(`    Ops/sec: ${result.opsPerSec.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, color);
  });
}

// Summary Report
function printSummary(allResults) {
  log('\n' + '='.repeat(60), 'bright');
  log('📋 Performance Summary', 'cyan');
  log('='.repeat(60), 'bright');

  const allBenchmarks = allResults.flat();
  const avgTime = allBenchmarks.reduce((sum, r) => sum + r.avgTime, 0) / allBenchmarks.length;
  const avgOps = allBenchmarks.reduce((sum, r) => sum + r.opsPerSec, 0) / allBenchmarks.length;

  log(`\nTotal Benchmarks: ${allBenchmarks.length}`, 'bright');
  log(`Average Time: ${formatTime(avgTime)}`, 'green');
  log(`Average Ops/sec: ${avgOps.toLocaleString('en-US', { maximumFractionDigits: 0 })}`, 'green');

  // Find slowest and fastest
  const slowest = allBenchmarks.reduce((a, b) => a.avgTime > b.avgTime ? a : b);
  const fastest = allBenchmarks.reduce((a, b) => a.avgTime < b.avgTime ? a : b);

  log(`\n⚡ Fastest: ${fastest.name} (${formatTime(fastest.avgTime)})`, 'green');
  log(`🐌 Slowest: ${slowest.name} (${formatTime(slowest.avgTime)})`, 'yellow');

  log('\n' + '='.repeat(60), 'bright');
}

// Run All Benchmarks
async function runAllBenchmarks() {
  log('\n🚀 VIB34D SDK Performance Benchmarks', 'bright');
  log('='.repeat(60), 'bright');
  log(`Node.js ${process.version}`, 'cyan');
  log(`Platform: ${process.platform} ${process.arch}`, 'cyan');
  log('='.repeat(60), 'bright');

  const allResults = [];

  allResults.push(benchmarkQuaternionOps());
  allResults.push(benchmark4DVectorOps());
  allResults.push(benchmarkSensorProcessing());
  allResults.push(benchmarkTelemetry());
  allResults.push(benchmarkLicense());

  printSummary(allResults);

  log('\n✅ Benchmarks complete!\n', 'green');
}

// Run
runAllBenchmarks().catch(console.error);
