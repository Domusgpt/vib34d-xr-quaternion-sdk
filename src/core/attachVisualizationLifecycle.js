import { registerCanvasLifecycle } from './registerCanvasLifecycle.js';

/**
 * Convenience helper that registers lifecycle callbacks against the shared
 * CanvasManager instance while normalizing the cleanup contract. Engines that
 * call this utility are guaranteed to apply their initial rotor state, receive
 * activation/deactivation notifications, and dispose of the bridge during
 * teardown.
 */
export function attachVisualizationLifecycle(systemName, handlers = {}) {
  if (!systemName) {
    return () => {};
  }

  return registerCanvasLifecycle(systemName, handlers);
}
