// Conservative capability hint: unknown hardware keeps the regular appearance.
// No UA sniffing; this only reduces decoration, never location or group updates.
export function prefersLightweightUI(device = globalThis.navigator) {
  return (Number(device?.deviceMemory) > 0 && device.deviceMemory <= 4)
    || (Number(device?.hardwareConcurrency) > 0 && device.hardwareConcurrency <= 4);
}

export function installPerformanceMode(root = document.documentElement, device = globalThis.navigator) {
  root.dataset.effects = prefersLightweightUI(device) ? 'reduced' : 'full';
}
