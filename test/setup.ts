// jsdom has no layout engine. Radix uses ResizeObserver to position tooltip arrows.
if (typeof window !== 'undefined' && typeof ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
}
