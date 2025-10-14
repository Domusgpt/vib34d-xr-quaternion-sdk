export function toFixedArray(data, decimals = 3) {
  if (!data) {
    return [];
  }
  return Array.from(data, (value) => Number(Number(value).toFixed(decimals)));
}

export function createLoggingRing(label, options = {}) {
  const {
    decimals = 3,
    log = true,
    includePoseBreakdown = true,
  } = options;

  return {
    label,
    updates: [],
    update(_device, data) {
      const snapshot = toFixedArray(data, decimals);
      this.updates.push(snapshot);
      if (!log) {
        return;
      }
      console.log(`\n[uniform:${label}] update ->`, snapshot);
      if (!includePoseBreakdown || label !== 'pose-uniforms') {
        return;
      }
      const smoothedPosition = snapshot.slice(20, 23);
      const smoothedVelocity = snapshot.slice(24, 27);
      const smoothedAcceleration = snapshot.slice(28, 31);
      const angularVelocity = snapshot.slice(32, 35);
      const angularAcceleration = snapshot.slice(36, 39);
      const smoothedAngularVelocity = snapshot.slice(40, 43);
      const smoothedAngularAcceleration = snapshot.slice(44, 47);
      const jerk = snapshot.slice(48, 51);
      const smoothedJerk = snapshot.slice(52, 55);
      const angularJerk = snapshot.slice(56, 59);
      const smoothedAngularJerk = snapshot.slice(60, 63);
      const snap = snapshot.slice(64, 67);
      const smoothedSnap = snapshot.slice(68, 71);
      const angularSnap = snapshot.slice(72, 75);
      const smoothedAngularSnap = snapshot.slice(76, 79);
      console.log('  ↳ smoothed translation:', smoothedPosition);
      console.log('  ↳ smoothed velocity   :', smoothedVelocity, 'speed=', snapshot[18]);
      console.log('  ↳ smoothed acceleration:', smoothedAcceleration, 'magnitude=', snapshot[19]);
      console.log('  ↳ angular velocity    :', angularVelocity, 'speed=', snapshot[35]);
      console.log('  ↳ angular acceleration:', angularAcceleration, 'magnitude=', snapshot[39]);
      console.log('  ↳ angular velocity (smoothed)    :', smoothedAngularVelocity, 'factor=', snapshot[43]);
      console.log('  ↳ angular acceleration (smoothed):', smoothedAngularAcceleration, 'factor=', snapshot[47]);
      console.log('  ↳ jerk                :', jerk, 'magnitude=', snapshot[51]);
      console.log('  ↳ jerk (smoothed)     :', smoothedJerk, 'factor=', snapshot[55]);
      console.log('  ↳ angular jerk        :', angularJerk, 'magnitude=', snapshot[59]);
      console.log('  ↳ angular jerk (smoothed):', smoothedAngularJerk, 'factor=', snapshot[63]);
      console.log('  ↳ snap                :', snap, 'magnitude=', snapshot[67]);
      console.log('  ↳ snap (smoothed)     :', smoothedSnap, 'factor=', snapshot[71]);
      console.log('  ↳ angular snap        :', angularSnap, 'magnitude=', snapshot[75]);
      console.log('  ↳ angular snap (smoothed):', smoothedAngularSnap, 'factor=', snapshot[79]);
    },
    getReadableBuffer() {
      return { label: `${label}-buffer` };
    },
  };
}

export function createMockDevice(options = {}) {
  const {
    log = true,
    onWriteBuffer = null,
    onSubmit = null,
  } = options;

  const device = {
    createdTextures: [],
    queue: {
      writeBuffer(buffer, _offset, data) {
        if (log) {
          const label = buffer?.label || 'anonymous-buffer';
          console.log(`[queue] writeBuffer -> ${label}, length=${data?.length ?? 'n/a'}`);
        }
        if (typeof onWriteBuffer === 'function') {
          onWriteBuffer({ buffer, data });
        }
      },
      submit(commands) {
        if (log) {
          console.log(`[queue] submit -> ${commands?.[0]?.label ?? 'commands'}`);
        }
        if (typeof onSubmit === 'function') {
          onSubmit(commands || []);
        }
      },
    },
    createBuffer({ label = 'buffer' } = {}) {
      return { label };
    },
    createBindGroup({ label = 'bindGroup', entries = [] } = {}) {
      if (log) {
        console.log(`[device] createBindGroup -> ${label} (entries=${entries.length})`);
      }
      return { label, entries };
    },
    createTexture({ label = 'texture', size, format } = {}) {
      if (log) {
        const width = size?.[0] ?? size?.width ?? 'n/a';
        const height = size?.[1] ?? size?.height ?? 'n/a';
        console.log(`[device] createTexture -> ${label} (${width}x${height} ${format})`);
      }
      const view = { label: `${label}-view` };
      const texture = {
        label,
        size,
        format,
        createView() {
          return view;
        },
      };
      device.createdTextures.push(texture);
      return texture;
    },
    createRenderBundleEncoder({ label = 'render-bundle', colorFormats } = {}) {
      if (log) {
        const formats = Array.isArray(colorFormats) ? colorFormats.join(', ') : '';
        console.log(`[device] createRenderBundleEncoder -> ${label} (formats=${formats})`);
      }
      const actions = [];
      return {
        label,
        actions,
        setPipeline(pipeline) {
          actions.push(['setPipeline', pipeline?.label ?? 'pipeline']);
        },
        setBindGroup(slot, bindGroup) {
          actions.push(['setBindGroup', slot, bindGroup?.label ?? 'bindGroup']);
        },
        draw(vertexCount) {
          actions.push(['draw', vertexCount]);
        },
        finish() {
          return { label: `${label}::bundle`, actions: [...actions] };
        },
      };
    },
    createCommandEncoder({ label = 'command-encoder' } = {}) {
      const passes = [];
      return {
        label,
        passes,
        beginRenderPass(descriptor) {
          const actions = [];
          return {
            descriptor,
            actions,
            setPipeline(pipeline) {
              actions.push(['setPipeline', pipeline?.label ?? 'pipeline']);
            },
            setBindGroup(slot, bindGroup) {
              actions.push(['setBindGroup', slot, bindGroup?.label ?? 'bindGroup']);
            },
            draw(vertexCount) {
              actions.push(['draw', vertexCount]);
            },
            executeBundles(bundles) {
              actions.push(['executeBundles', (bundles || []).map((bundle) => bundle.label)]);
            },
            end() {
              passes.push({ descriptor, actions: [...actions] });
            },
          };
        },
        finish() {
          return { label: `${label}::commands`, passes: [...passes] };
        },
      };
    },
  };

  return device;
}

export function summarizeCommandBuffer(commandBuffer) {
  if (!commandBuffer || !Array.isArray(commandBuffer.passes)) {
    return [];
  }
  return commandBuffer.passes.map((pass) => {
    const attachment = pass.descriptor?.colorAttachments?.[0];
    const target = attachment?.view?.label || 'unknown-target';
    return {
      target,
      actions: pass.actions.map((action) => {
        const [type, ...details] = action;
        return { type, details };
      }),
    };
  });
}

export function logPassSummary(frameLabel, commandBuffer) {
  const summary = summarizeCommandBuffer(commandBuffer);
  console.log(`\n=== ${frameLabel} summary ===`);
  summary.forEach((pass, index) => {
    console.log(`Pass ${index + 1}: target=${pass.target}`);
    pass.actions.forEach((action) => {
      console.log('  -', action.type, ...action.details);
    });
  });
  return summary;
}

export function makeQuaternionFromAxisY(degrees) {
  const radians = (degrees * Math.PI) / 180;
  return {
    x: 0,
    y: Math.sin(radians / 2),
    z: 0,
    w: Math.cos(radians / 2),
  };
}
