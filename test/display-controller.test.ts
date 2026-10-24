import { describe, expect, it, vi } from 'vitest';
import { DisplayController, START_MESSAGES, type DisplayDependencies, type DisplayLocation, type DisplayState } from '../src/client/display-controller.js';

const location: DisplayLocation = { latitude: 30, longitude: -81, stationId: '8720218', stationName: 'Mayport' };

function fixture(overrides: Partial<DisplayDependencies> = {}) {
  const changes: DisplayState[] = [];
  const dependencies: DisplayDependencies = {
    findCurrentLocation: vi.fn(async () => location),
    saveLocation: vi.fn(),
    chooseLocation: vi.fn(),
    onStart: vi.fn(),
    onChange: (state) => changes.push(state),
    ...overrides,
  };
  return { controller: new DisplayController(dependencies), dependencies, changes };
}

describe('Start display lifecycle', () => {
  it('uses the saved station without requesting browser location', async () => {
    const { controller, dependencies } = fixture({ location });
    await controller.initialize();
    await controller.useCurrentLocation();
    expect(dependencies.findCurrentLocation).not.toHaveBeenCalled();
    expect(controller.view()).toMatchObject({ screen: 'start', message: 'Mayport', location });
    controller.start();
    expect(dependencies.onStart).toHaveBeenCalledWith(location);
    expect(dependencies.saveLocation).toHaveBeenCalledWith(location);
    expect(controller.view().screen).toBe('display');
    controller.start();
    expect(dependencies.onStart).toHaveBeenCalledOnce();
  });

  it('offers map choice while the first browser position is pending, then starts only on request', async () => {
    let resolve!: (value: DisplayLocation) => void;
    const { controller, dependencies } = fixture({ findCurrentLocation: () => new Promise((done) => { resolve = done; }) });
    const pending = controller.initialize();
    expect(controller.view()).toMatchObject({ screen: 'start', findingLocation: true, message: START_MESSAGES.askingForLocation });
    expect(dependencies.onStart).not.toHaveBeenCalled();
    resolve(location);
    await pending;
    expect(controller.view()).toMatchObject({ location, findingLocation: false, message: 'Mayport' });
    expect(dependencies.saveLocation).not.toHaveBeenCalled();
    controller.start();
    expect(dependencies.onStart).toHaveBeenCalledWith(location);
  });

  it('routes denied or failed browser-location lookups to the picker', async () => {
    const { controller, dependencies } = fixture({ findCurrentLocation: vi.fn(async () => { throw new Error('Offline'); }) });
    await controller.initialize();
    expect(controller.view().message).toBe(START_MESSAGES.noLocation);
    controller.start();
    expect(dependencies.chooseLocation).toHaveBeenCalledOnce();
    expect(dependencies.onStart).not.toHaveBeenCalled();
  });

  it('can start the selected station when device storage is blocked', () => {
    const { controller, dependencies } = fixture({ location, saveLocation: () => { throw new Error('Storage blocked'); } });
    controller.start();
    expect(controller.view().screen).toBe('display');
    expect(dependencies.onStart).toHaveBeenCalledWith(location);
  });

  it('does not let a late permission answer override a map navigation', async () => {
    let resolve!: (value: DisplayLocation) => void;
    const { controller } = fixture({ findCurrentLocation: () => new Promise((done) => { resolve = done; }) });
    const pending = controller.initialize();
    controller.chooseLocation();
    resolve(location);
    await pending;
    expect(controller.view().location).toBeUndefined();
  });

  it('prevents duplicate position requests while permission is pending', async () => {
    let resolve!: (value: DisplayLocation | undefined) => void;
    const findCurrentLocation = vi.fn(() => new Promise<DisplayLocation | undefined>((done) => { resolve = done; }));
    const { controller } = fixture({ findCurrentLocation });
    const pending = controller.initialize();
    await controller.useCurrentLocation();
    expect(findCurrentLocation).toHaveBeenCalledOnce();
    resolve(undefined);
    await pending;
  });

  it('returns to Start with the session-ended message and resumes the same station', async () => {
    const { controller, dependencies } = fixture({ location });
    await controller.initialize();
    controller.start();
    controller.sessionEnded();
    expect(controller.view()).toMatchObject({ screen: 'start', location, message: START_MESSAGES.sessionEnded });
    controller.updateLocationName(location.stationId, 'Mayport Bar Pilots Dock');
    expect(controller.view().message).toBe(START_MESSAGES.sessionEnded);
    controller.start();
    expect(dependencies.onStart).toHaveBeenLastCalledWith({ ...location, stationName: 'Mayport Bar Pilots Dock' });
    expect(controller.view()).toMatchObject({ screen: 'display', message: '' });
  });

  it('ignores metadata for a different station and protects the published snapshot', () => {
    const { controller } = fixture({ location });
    controller.updateLocationName('other', 'Wrong station');
    const view = controller.view();
    view.location!.stationName = 'Changed outside the controller';
    expect(controller.view().location?.stationName).toBe('Mayport');
  });
});
