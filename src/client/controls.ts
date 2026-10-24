import './controls.css';
import {
  readDisplaySettings,
  resetDisplaySettings,
  setDisplaySettings,
  subscribeDisplaySettings,
  type DisplaySettings,
} from './display-settings.js';

export interface TopBarOptions {
  onLocation?: () => void;
  /** Reset has already restored display preferences; the selected location must stay unchanged. */
  onReset?: () => void;
  onPreferencesChange?: (settings: DisplaySettings) => void;
}

export interface TopBar {
  /** Pass a public station name, not an address or a search query. It is never persisted. */
  setLocationName(name: string): void;
  destroy(): void;
}

let nextDialogId = 0;

/** Source-style controls, kept separate so the start screen and graph share one preference store. */
export function mountTopBar(root: HTMLElement, options: TopBarOptions = {}): TopBar {
  const doc = root.ownerDocument;
  const header = doc.createElement('header');
  header.className = 'topbar';
  // These fixed SVG paths are copied from the established top-bar controls.
  header.innerHTML = `
    <img class="topbar-mark" src="/assets/brand/logo/logo.svg" alt="" width="36" height="36">
    <span class="topbar-name">Tidepin</span>
    <p class="topbar-location" role="status">Choose a location</p>
    <nav class="topbar-actions" aria-label="Display controls">
      <button type="button" class="icon-button" data-control="settings" aria-label="Settings" aria-haspopup="dialog" aria-expanded="false" title="Settings">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.61 9.53 L22.26 9.75 L22.26 14.25 L19.61 14.47 L19.13 15.63 L20.84 17.66 L17.66 20.84 L15.63 19.13 L14.47 19.61 L14.25 22.26 L9.75 22.26 L9.53 19.61 L8.37 19.13 L6.34 20.84 L3.16 17.66 L4.87 15.63 L4.39 14.47 L1.74 14.25 L1.74 9.75 L4.39 9.53 L4.87 8.37 L3.16 6.34 L6.34 3.16 L8.37 4.87 L9.53 4.39 L9.75 1.74 L14.25 1.74 L14.47 4.39 L15.63 4.87 L17.66 3.16 L20.84 6.34 L19.13 8.37Z"/><circle cx="12" cy="12" r="3"/></svg><span class="button-label">Settings</span>
      </button>
      <a href="/location" class="icon-button" data-control="location" aria-label="Location" title="Location">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22s7-6.2 7-12a7 7 0 0 0-14 0c0 5.8 7 12 7 12z"/><circle cx="12" cy="10" r="2.5"/></svg><span class="button-label">Location</span>
      </a>
      <button type="button" class="icon-button" data-control="fullscreen" aria-label="Full screen" title="Full screen (Esc or F11 to leave)" hidden>
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/></svg><span class="button-label">Full screen</span>
      </button>
    </nav>`;

  const dialog = doc.createElement('dialog');
  dialog.className = 'display-settings';
  dialog.id = `tidepin-settings-${++nextDialogId}`;
  dialog.setAttribute('aria-labelledby', `${dialog.id}-title`);
  dialog.innerHTML = `
    <form method="dialog" class="settings-form">
      <h2 id="${dialog.id}-title">Settings</h2>
      <div class="settings-units">
        <label>Height unit<select name="heightUnit"><option value="ft">Feet (ft)</option><option value="m">Meters (m)</option></select></label>
        <label>Clock<select name="clockFormat"><option value="12h">12-hour (1 PM)</option><option value="24h">24-hour (13:00)</option></select></label>
      </div>
      <p class="settings-note">Height units apply to every tide height.</p>
      <div class="settings-footer">
        <button type="button" class="settings-reset" title="Every setting here back to its default. The location stays.">Reset</button>
        <button type="submit" class="settings-done">Done</button>
      </div>
      <p class="settings-feedback" role="status" aria-live="polite"></p>
    </form>`;

  const settingsButton = header.querySelector<HTMLButtonElement>('[data-control="settings"]')!;
  const fullscreenButton = header.querySelector<HTMLButtonElement>('[data-control="fullscreen"]')!;
  const locationLink = header.querySelector<HTMLAnchorElement>('[data-control="location"]')!;
  const stationName = header.querySelector<HTMLElement>('.topbar-location')!;
  const heightSelect = dialog.querySelector<HTMLSelectElement>('[name="heightUnit"]')!;
  const clockSelect = dialog.querySelector<HTMLSelectElement>('[name="clockFormat"]')!;
  const resetButton = dialog.querySelector<HTMLButtonElement>('.settings-reset')!;
  const feedback = dialog.querySelector<HTMLElement>('.settings-feedback')!;
  settingsButton.setAttribute('aria-controls', dialog.id);

  const events = new AbortController();
  const { signal } = events;
  function fill(settings: DisplaySettings): void {
    heightSelect.value = settings.heightUnit;
    clockSelect.value = settings.clockFormat;
  }
  fill(readDisplaySettings());
  const unsubscribe = subscribeDisplaySettings((settings) => {
    fill(settings);
    options.onPreferencesChange?.(settings);
  });

  settingsButton.addEventListener('click', () => {
    fill(readDisplaySettings());
    feedback.textContent = '';
    if (!dialog.open) dialog.showModal();
    settingsButton.setAttribute('aria-expanded', 'true');
  }, { signal });
  dialog.addEventListener('close', () => {
    settingsButton.setAttribute('aria-expanded', 'false');
  }, { signal });
  heightSelect.addEventListener('change', () => {
    setDisplaySettings({ heightUnit: heightSelect.value === 'm' ? 'm' : 'ft' });
    feedback.textContent = '';
  }, { signal });
  clockSelect.addEventListener('change', () => {
    setDisplaySettings({ clockFormat: clockSelect.value === '24h' ? '24h' : '12h' });
    feedback.textContent = '';
  }, { signal });
  resetButton.addEventListener('click', () => {
    fill(resetDisplaySettings());
    feedback.textContent = 'Settings reset. Your location is unchanged.';
    options.onReset?.();
  }, { signal });
  locationLink.addEventListener('click', (event) => {
    if (options.onLocation && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) {
      event.preventDefault();
      options.onLocation();
    }
  }, { signal });

  fullscreenButton.hidden = !doc.fullscreenEnabled || typeof doc.documentElement.requestFullscreen !== 'function';
  fullscreenButton.addEventListener('click', () => {
    // Full screen is only requested by this explicit click. Browser policy may refuse it.
    void doc.documentElement.requestFullscreen().catch(() => {});
  }, { signal });
  root.classList.add('display-controls');
  root.append(header, dialog);

  return {
    setLocationName(name) { stationName.textContent = name.trim() || 'Choose a location'; },
    destroy() {
      events.abort();
      unsubscribe();
      if (dialog.open) dialog.close();
      header.remove();
      dialog.remove();
      root.classList.remove('display-controls');
    },
  };
}
