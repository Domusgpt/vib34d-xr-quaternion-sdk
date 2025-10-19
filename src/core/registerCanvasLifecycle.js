export function registerCanvasLifecycle(systemName, handlers = {}) {
  if (typeof window === 'undefined') {
    return () => {};
  }

  const manager = window.canvasManager;
  if (!manager || typeof manager.registerLifecycle !== 'function') {
    return () => {};
  }

  try {
    return manager.registerLifecycle(systemName, handlers);
  } catch (error) {
    console.warn('⚠️ Failed to register canvas lifecycle handlers', error);
    return () => {};
  }
}
