import { locationLabel, START_MESSAGES, type DisplayState } from './display-controller.js';

export { START_MESSAGES } from './display-controller.js';

export interface StartScreenActions {
  start: () => void;
  chooseLocation: () => void;
  useCurrentLocation: () => void;
}

export function mountStartScreen(root: HTMLElement, actions: StartScreenActions) {
  const section = document.createElement('section');
  section.className = 'start-screen';
  section.setAttribute('aria-labelledby', 'start-title');
  const logo = document.createElement('img');
  logo.className = 'start-mark';
  logo.src = '/assets/brand/logo/tidepin-transparent-logo.png';
  logo.alt = 'Tidepin tide-wave location pin';
  logo.width = 736;
  logo.height = 756;
  const title = document.createElement('h1');
  title.id = 'start-title';
  title.textContent = 'Tidepin';
  const start = document.createElement('button');
  start.className = 'start-button';
  start.type = 'button';
  start.addEventListener('click', actions.start);
  const message = document.createElement('p');
  message.className = 'start-message';
  message.setAttribute('role', 'status');
  message.setAttribute('aria-live', 'polite');
  const choices = document.createElement('div');
  choices.className = 'start-choices';
  const current = document.createElement('button');
  current.type = 'button';
  current.className = 'start-secondary';
  current.textContent = 'Use current location';
  current.addEventListener('click', actions.useCurrentLocation);
  const picker = document.createElement('button');
  picker.type = 'button';
  picker.className = 'start-secondary';
  picker.textContent = 'Choose on map';
  picker.addEventListener('click', actions.chooseLocation);
  choices.append(current, picker);
  section.append(logo, title, start, message, choices);
  root.append(section);
  return {
    update(state: DisplayState): void {
      section.hidden = state.screen !== 'start';
      section.classList.toggle('start-screen--ended', state.message === START_MESSAGES.sessionEnded);
      start.textContent = state.location ? 'Start display' : 'Set location';
      message.textContent = state.message || (state.location ? locationLabel(state.location) : '');
      current.disabled = state.findingLocation;
      current.textContent = state.findingLocation ? 'Finding your location…' : 'Use current location';
      current.hidden = Boolean(state.location);
      picker.hidden = !state.location && !state.findingLocation;
    },
    focus(): void { start.focus(); },
    destroy(): void { section.remove(); },
  };
}
