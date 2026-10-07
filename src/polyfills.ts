if (typeof globalThis.structuredClone !== 'function') {
  globalThis.structuredClone = function <T>(value: T): T {
    if (value === undefined) return undefined as unknown as T;
    return JSON.parse(JSON.stringify(value));
  } as typeof structuredClone;
}
