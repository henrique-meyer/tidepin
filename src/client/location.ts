/// <reference types="google.maps" />
import './style.css';
import './footer.css';
import './location.css';
import { fetchClientConfig, loadGoogleMaps } from './client-config.js';
import { currentPosition } from './geolocation.js';
import { isValidCoordinates, markReturnToDisplay, readLocation, saveLocation, type Coordinates } from './location-settings.js';
import { googlePlacesBackend, PlaceSearch, previousSuggestionIndex, type GoogleSuggestion } from './place-search.js';
import type { TideStation } from '../shared/stations.js';

const element = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const searchInput = element<HTMLInputElement>('search-input');
const searchResults = element<HTMLUListElement>('search-results');
const searchPopup = element<HTMLDivElement>('search-popup');
const pointReadout = element<HTMLParagraphElement>('point-readout');
const stationReadout = element<HTMLParagraphElement>('station-readout');
const useHere = element<HTMLButtonElement>('use-here');
const saveButton = element<HTMLButtonElement>('save');
const status = element<HTMLParagraphElement>('picker-status');
const mapElement = element<HTMLDivElement>('map');
const saved = readLocation();
let point: Coordinates | undefined = saved ? { latitude: saved.latitude, longitude: saved.longitude } : undefined;
let station: TideStation | undefined;
let dirty = false;
let generation = 0;
let drawMap: ((pan: boolean) => void) | undefined;
let cancelSearch: (() => void) | undefined;

element<HTMLAnchorElement>('back-to-display').addEventListener('click', () => markReturnToDisplay());

function updateControls(): void {
  pointReadout.textContent = point ? `Point: ${point.latitude.toFixed(4)}, ${point.longitude.toFixed(4)}` : 'No point set yet. Click the map or search for a place.';
  saveButton.disabled = !point || !station;
}

async function resolveStation(): Promise<void> {
  const current = ++generation;
  station = undefined;
  updateControls();
  if (!point) return;
  stationReadout.textContent = 'Finding the nearest NOAA tide station…';
  try {
    const response = await fetch('/api/stations/nearest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ latitude: point.latitude, longitude: point.longitude }) });
    if (!response.ok) throw new Error('Station lookup failed.');
    const result = await response.json() as { station: TideStation };
    if (current !== generation) return;
    station = result.station;
    stationReadout.textContent = `Nearest tide station: ${station.name}${station.curveSupported ? '' : ' (high/low predictions only)'}${station.timeZoneId ? '' : ' — local time unavailable'}`;
  } catch {
    if (current !== generation) return;
    stationReadout.textContent = 'Could not find a tide station. Move the pin or try again when online.';
  }
  updateControls();
}

function setPoint(next: Coordinates, pan = false): void {
  if (!isValidCoordinates(next)) return;
  cancelSearch?.();
  searchInput.value = '';
  point = { latitude: next.latitude, longitude: next.longitude };
  dirty = true;
  status.textContent = '';
  drawMap?.(pan);
  void resolveStation();
}

function setupSearch(places: google.maps.PlacesLibrary): void {
  let shown: GoogleSuggestion[] = [];
  let active = -1;
  const render = (suggestions: GoogleSuggestion[]) => {
    shown = suggestions;
    active = -1;
    searchResults.replaceChildren(...suggestions.map((suggestion, index) => {
      const item = document.createElement('li');
      item.id = `search-result-${index}`;
      item.role = 'option';
      const main = document.createElement('span'); main.textContent = suggestion.main;
      const secondary = document.createElement('span'); secondary.className = 'result-secondary'; secondary.textContent = suggestion.secondary;
      item.append(main, secondary);
      item.addEventListener('mousedown', event => { event.preventDefault(); void choose(suggestion); });
      return item;
    }));
    searchPopup.hidden = !suggestions.length;
    searchInput.setAttribute('aria-expanded', String(Boolean(suggestions.length)));
    searchInput.removeAttribute('aria-activedescendant');
  };
  const search = new PlaceSearch(googlePlacesBackend(places), {
    onSuggestions: render,
    onError: () => { render([]); status.textContent = 'Place search is unavailable right now. Click the map to set the point.'; },
  });
  cancelSearch = () => { search.cancelPending(); render([]); };
  const choose = async (suggestion: GoogleSuggestion) => {
    searchInput.value = '';
    try {
      const found = await search.choose(suggestion);
      if (found) setPoint(found, true);
    } catch { status.textContent = 'Could not look up that place. Try another or click the map.'; }
  };
  const highlight = (index: number) => {
    active = index;
    [...searchResults.children].forEach((item, i) => item.setAttribute('aria-selected', String(i === index)));
    searchInput.setAttribute('aria-activedescendant', `search-result-${index}`);
  };
  searchInput.addEventListener('input', () => search.input(searchInput.value));
  searchInput.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' && shown.length) { event.preventDefault(); highlight((active + 1) % shown.length); }
    else if (event.key === 'ArrowUp' && shown.length) { event.preventDefault(); highlight(previousSuggestionIndex(active, shown.length)); }
    else if (event.key === 'Enter') { event.preventDefault(); const selected = shown[active >= 0 ? active : 0]; if (selected) void choose(selected); }
    else if (event.key === 'Escape') { searchInput.value = ''; search.input(''); }
  });
  searchInput.addEventListener('blur', () => render([]));
  window.addEventListener('pagehide', () => { searchInput.value = ''; search.cancelPending(); render([]); });
  searchInput.disabled = false;
}

async function start(): Promise<void> {
  useHere.hidden = !('geolocation' in navigator);
  void navigator.permissions?.query({ name: 'geolocation' }).then(permission => {
    const update = () => { useHere.hidden = permission.state === 'denied'; };
    update(); permission.addEventListener('change', update);
  }).catch(() => undefined);
  if (point) void resolveStation();
  let config;
  try { config = await fetchClientConfig(); }
  catch { status.textContent = 'Could not load location tools. Reload to try again.'; return; }
  if (!config.googleMapsApiKey) {
    mapElement.replaceChildren(Object.assign(document.createElement('p'), { className: 'map-message', textContent: 'The map is unavailable here. You can still use your current location.' }));
    return;
  }
  try {
    await loadGoogleMaps(config.googleMapsApiKey, () => { status.textContent = 'The map is unavailable for this page.'; });
    const [{ Map }, { AdvancedMarkerElement }, places] = await Promise.all([
      google.maps.importLibrary('maps'), google.maps.importLibrary('marker'), google.maps.importLibrary('places'),
    ]);
    mapElement.replaceChildren();
    const latLng = (value: Coordinates) => ({ lat: value.latitude, lng: value.longitude });
    const map = new Map(mapElement, { center: point ? latLng(point) : { lat: 39.5, lng: -98.35 }, zoom: point ? 10 : 4, mapId: config.googleMapsMapId, clickableIcons: false, streetViewControl: false, mapTypeControl: false, fullscreenControl: false });
    const marker = new AdvancedMarkerElement({ map: point ? map : null, position: point ? latLng(point) : undefined, gmpDraggable: true, title: 'Tide location. Drag to move.' });
    drawMap = (pan) => { marker.map = point ? map : null; if (point) { marker.position = latLng(point); if (pan) { map.panTo(latLng(point)); map.setZoom(10); } } updateControls(); };
    map.addListener('click', (event: google.maps.MapMouseEvent) => { if (event.latLng) setPoint({ latitude: event.latLng.lat(), longitude: event.latLng.lng() }); });
    marker.addEventListener('gmp-dragend', () => {
      const position = marker.position;
      if (!position) return;
      const value = position instanceof google.maps.LatLng ? position : new google.maps.LatLng(position);
      setPoint({ latitude: value.lat(), longitude: value.lng() });
    });
    setupSearch(places);
    if (!point) {
      const here = await currentPosition();
      if (here && !point) setPoint(here, true);
      else if (!point) status.textContent = 'Find your area, then click the map or search to set the point.';
    }
  } catch {
    mapElement.replaceChildren(Object.assign(document.createElement('p'), { className: 'map-message', textContent: 'The map could not load. You can still use your current location.' }));
    status.textContent = 'The map is unavailable right now.';
  }
}

useHere.addEventListener('click', async () => {
  const selectedGeneration = generation;
  useHere.disabled = true; status.textContent = 'Finding your location…';
  const here = await currentPosition(); useHere.disabled = false;
  if (selectedGeneration !== generation) return;
  if (here) setPoint(here, true); else status.textContent = 'Your location is not available right now.';
});
saveButton.addEventListener('click', () => {
  if (!point || !station) return;
  try {
    saveLocation({ latitude: point.latitude, longitude: point.longitude, stationId: station.id });
    dirty = false;
    markReturnToDisplay();
    window.location.assign('/');
  } catch { status.textContent = 'This browser would not save the location. Check that site data is allowed.'; }
});
window.addEventListener('beforeunload', event => { if (dirty) event.preventDefault(); });
updateControls();
void start();
