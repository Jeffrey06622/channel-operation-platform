const RELOAD_FLAG = 'hotel-decision-chunk-reload';

export function installBootGuard(): void {
  window.addEventListener('vite:preloadError', (event) => {
    event.preventDefault();
    try {
      if (sessionStorage.getItem(RELOAD_FLAG)) return;
      sessionStorage.setItem(RELOAD_FLAG, '1');
    } catch {
      return;
    }
    window.location.reload();
  });
}

export function markBooted(): void {
  (window as unknown as { __appBooted?: boolean }).__appBooted = true;
  try {
    sessionStorage.removeItem(RELOAD_FLAG);
  } catch {
    // storage unavailable: the reload guard simply stays inactive
  }
}
