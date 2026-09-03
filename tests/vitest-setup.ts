/**
 * Vitest global setup — defensive minimum.
 *
 * The renderer code expects `window.marloues` and `window.localStorage` to
 * exist when stores / services evaluate at module-init time (e.g.
 * `ipc-client` does `window.marloues`; `theme-store` reads
 * `window.localStorage.getItem(...)`).
 * Without these, importing a component from a barrel transitively loads
 * those stores and crashes in the `node` test env.
 *
 * IMPORTANT: We deliberately do NOT shim `document`. Many tests already
 * mock what they need via `vi.hoisted(...)`, and libraries like `sonner`
 * defensively `typeof document === 'undefined'` to early-return. Providing
 * a partial shim can be *worse* than undefined (sonner would then reach
 * a method that doesn't exist on our shim).
 *
 * If a specific test needs `document` / `matchMedia` / etc., the test
 * file should declare it via `vi.hoisted(...)` — see existing tests for
 * the pattern.
 */

type GlobalWithBrowser = typeof globalThis & {
  window?: Record<string, unknown>;
};

const g = globalThis as GlobalWithBrowser;

if (typeof g.window === "undefined") {
  g.window = {};
}

const win = g.window as Record<string, unknown>;

// Some renderer dependencies inspect window.navigator during module setup.
// Node 20 does not expose it, so provide the one stable field they require.
if (typeof win.navigator === "undefined") {
  win.navigator = { userAgent: "marloues-vitest" };
}
if (typeof globalThis.navigator === "undefined") {
  Object.defineProperty(globalThis, "navigator", {
    value: win.navigator,
    configurable: true,
  });
}

// Minimal `window.marloues` surface so renderer modules can be imported.
// Individual test files should still mock behavior they care about via
// `vi.mock("@/lib/ipc-client", ...)` or similar — this is just the baseline
// shape that prevents ReferenceError on module load.
if (typeof win.marloues === "undefined") {
  win.marloues = {
    auth: { onStatusChanged: () => () => {} },
    window: {
      minimize: () => Promise.resolve(),
      maximize: () => Promise.resolve(),
      close: () => Promise.resolve(),
    },
  };
}

// In-memory localStorage shim so theme-store / settings-store can evaluate
// at module-init time without crashing. Tests that need specific values
// should override via `vi.hoisted` or by reassigning `window.localStorage`.
if (typeof win.localStorage === "undefined") {
  const map = new Map<string, string>();
  const shim: Storage = {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => (map.has(key) ? (map.get(key) as string) : null),
    key: (i) => Array.from(map.keys())[i] ?? null,
    removeItem: (key) => {
      map.delete(key);
    },
    setItem: (key, value) => {
      map.set(String(key), String(value));
    },
  };
  win.localStorage = shim;
}
