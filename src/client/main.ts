import './style.css';
import './start-screen.css';
import { mountTopBar } from './controls.js';
import { DisplayController, locationLabel, type DisplayLocation, type DisplayState } from './display-controller.js';
import { readDisplaySettings } from './display-settings.js';
import { currentPosition } from './geolocation.js';
import { readLocation, saveLocation, takeReturnToDisplay } from './location-settings.js';
import { mountStartScreen } from './start-screen.js';

const main = document.querySelector('main');
if (!main) throw new Error('The display requires a main element.');
main.classList.add('display-page');
main.replaceChildren();

const toolbarRoot = document.createElement('div');
toolbarRoot.className = 'display-topbar';
toolbarRoot.hidden = true;
main.append(toolbarRoot);

const display = document.createElement('section');
display.className = 'tide-display';
display.id = 'tide-display';
display.setAttribute('aria-label', 'Tide display');
display.hidden = true;
const station = document.createElement('h2');
station.id = 'station-name';
station.tabIndex = -1;
const chart = document.createElement('div');
chart.id = 'tide-chart';
display.append(station, chart);

function chooseLocation(): void {
  window.location.assign('/location');
}

const topBar = mountTopBar(toolbarRoot, {
  onLocation: chooseLocation,
  onPreferencesChange: (preferences) => {
    window.dispatchEvent(new CustomEvent('tidepin:preferences-changed', { detail: { preferences } }));
  },
});

const startScreen = mountStartScreen(main, {
  start: () => { void startDisplay(); },
  chooseLocation: () => controller.chooseLocation(),
  useCurrentLocation: () => { void controller.useCurrentLocation(); },
});
main.append(display);

let starting = false;
async function startDisplay(): Promise<void> {
  if (starting) return;
  starting = true;
  try {
    const state = controller.view();
    if (!state.location && !state.findingLocation) {
      // A previously timed-out permission request may now be granted, without a change event.
      const permission = await navigator.permissions?.query({ name: 'geolocation' }).catch(() => undefined);
      if (permission?.state === 'granted') await controller.useCurrentLocation();
    }
    controller.start();
  } finally {
    starting = false;
  }
}

function render(state: DisplayState): void {
  startScreen.update(state);
  display.hidden = state.screen !== 'display';
  toolbarRoot.hidden = state.screen !== 'display';
  main!.dataset.displayState = state.screen;
  document.body.dataset.displayState = state.screen;
  const label = state.location ? locationLabel(state.location) : '';
  station.textContent = label;
  topBar.setLocationName(label);
}

async function stationFromResponse(response: Response): Promise<{ id: string; name: string } | undefined> {
  if (!response.ok) return undefined;
  const data: unknown = await response.json();
  if (!data || typeof data !== 'object' || !('station' in data)) return undefined;
  const candidate = data.station;
  if (!candidate || typeof candidate !== 'object' || !('id' in candidate) || !('name' in candidate)) return undefined;
  return typeof candidate.id === 'string' && /^[A-Za-z0-9]{7}$/.test(candidate.id)
    && typeof candidate.name === 'string' && candidate.name.length > 0
    ? { id: candidate.id, name: candidate.name } : undefined;
}

async function findCurrentLocation(): Promise<DisplayLocation | undefined> {
  const coordinates = await currentPosition();
  if (!coordinates) return undefined;
  const response = await fetch('/api/stations/nearest', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(coordinates),
    signal: AbortSignal.timeout(15_000),
  });
  const station = await stationFromResponse(response);
  return station ? { ...coordinates, stationId: station.id, stationName: station.name } : undefined;
}

const savedLocation = readLocation();
const controller = new DisplayController({
  location: savedLocation,
  findCurrentLocation,
  saveLocation: ({ latitude, longitude, stationId }) => { saveLocation({ latitude, longitude, stationId }); },
  chooseLocation,
  onChange: render,
  onStart: (location) => {
    station.focus();
    window.dispatchEvent(new CustomEvent('tidepin:display-start', {
      detail: { location, preferences: readDisplaySettings() },
    }));
  },
});

window.addEventListener('tidepin:session-ended', () => {
  controller.sessionEnded();
  startScreen.focus();
});

// A saved picker result returns to the main display; an ordinary reload still requires Start.
if (takeReturnToDisplay() && savedLocation) controller.start();
void controller.initialize();

// A permission prompt can outlive its first request; a later grant should enable Start without a reload.
void navigator.permissions?.query({ name: 'geolocation' }).then((permission) => {
  permission.addEventListener('change', () => {
    const state = controller.view();
    if (permission.state === 'granted' && state.screen === 'start' && !state.location) {
      void controller.useCurrentLocation();
    }
  });
}).catch(() => { /* The map choice and retry button work without the Permissions API. */ });

if (savedLocation) {
  void fetch(`/api/stations/${encodeURIComponent(savedLocation.stationId)}`, { signal: AbortSignal.timeout(15_000) })
    .then(stationFromResponse)
    .then((station) => {
      if (station) controller.updateLocationName(station.id, station.name);
    })
    .catch(() => { /* A saved station remains usable if its display name cannot be refreshed. */ });
}
