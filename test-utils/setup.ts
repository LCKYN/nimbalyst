import { vi, describe, it, test, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import * as dotenv from 'dotenv';
import * as path from 'path';
// Load environment variables from .env file
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Make vitest globals available globally
(global as any).describe = describe;
(global as any).it = it;
(global as any).test = test;
(global as any).expect = expect;
(global as any).beforeEach = beforeEach;
(global as any).afterEach = afterEach;
(global as any).beforeAll = beforeAll;
(global as any).afterAll = afterAll;
(global as any).vi = vi;

// Mock window.matchMedia if not available
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
}

// Mock IntersectionObserver if not available
if (typeof window !== 'undefined' && !window.IntersectionObserver) {
  // @ts-ignore
  window.IntersectionObserver = class IntersectionObserver {
    constructor() {}
    disconnect() {}
    observe() {}
    unobserve() {}
    takeRecords() {
      return [];
    }
  };
}

// Mock ResizeObserver if not available  
if (typeof window !== 'undefined' && !window.ResizeObserver) {
  // @ts-ignore
  window.ResizeObserver = class ResizeObserver {
    constructor() {}
    disconnect() {}
    observe() {}
    unobserve() {}
  };
}

// Mermaid and other SVG tooling rely on getBBox, which jsdom does not implement.
if (typeof window !== 'undefined' && typeof SVGElement !== 'undefined' && !(SVGElement.prototype as any).getBBox) {
  (SVGElement.prototype as any).getBBox = function() {
    const text = (this as SVGElement).textContent || '';
    return {
      x: 0,
      y: 0,
      width: Math.max(1, text.length * 8),
      height: 16,
    };
  };
}

// Node 24+ ships its own experimental `localStorage`/`sessionStorage` globals,
// exposed as configurable getters that return `undefined` unless the process was
// started with `--localstorage-file`. Vitest's jsdom environment only installs a
// window global when the key is absent from `globalThis`, so Node's placeholder
// shadows jsdom's real `Storage` and every `localStorage.getItem` in a component
// throws "Cannot read properties of undefined". Restore a working Storage when
// -- and only when -- that has happened, so the suite behaves the same on the
// pinned Node 24 and on newer runtimes.
if (typeof window !== 'undefined') {
  const installStorage = (key: 'localStorage' | 'sessionStorage') => {
    if ((globalThis as any)[key] != null) return;

    const entries = new Map<string, string>();
    const storage: Storage = {
      get length() {
        return entries.size;
      },
      key(index: number) {
        return Array.from(entries.keys())[index] ?? null;
      },
      getItem(name: string) {
        return entries.has(String(name)) ? entries.get(String(name))! : null;
      },
      setItem(name: string, value: string) {
        entries.set(String(name), String(value));
      },
      removeItem(name: string) {
        entries.delete(String(name));
      },
      clear() {
        entries.clear();
      },
    };

    Object.defineProperty(globalThis, key, {
      value: storage,
      configurable: true,
      writable: true,
    });
  };

  installStorage('localStorage');
  installStorage('sessionStorage');
}

// Mock CSS imports
vi.mock('*.css', () => ({}));
