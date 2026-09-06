/**
 * What jsdom lacks and the component library expects. Floating UI observes
 * element sizes, popups scroll items into view, and the sidebar asks about
 * the viewport; none of it needs to work, only to exist.
 */
import '@testing-library/jest-dom/vitest';

class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

globalThis.ResizeObserver ??=
  ResizeObserverStub as unknown as typeof ResizeObserver;

Element.prototype.scrollIntoView ??= () => undefined;
Element.prototype.hasPointerCapture ??= () => false;
Element.prototype.releasePointerCapture ??= () => undefined;
Element.prototype.setPointerCapture ??= () => undefined;

window.matchMedia ??= ((query: string) =>
  ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }) as MediaQueryList) as typeof window.matchMedia;

// Saving a file goes through an object URL, which jsdom does not make.
URL.createObjectURL ??= () => 'blob:jsdom/test';
URL.revokeObjectURL ??= () => undefined;
