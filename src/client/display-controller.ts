export interface DisplayLocation {
  latitude: number;
  longitude: number;
  stationId: string;
  /** Display metadata only; never included in the saved location. */
  stationName?: string;
}

export const START_MESSAGES = {
  askingForLocation: 'Allow your location to see tides near you, or choose a place on the map.',
  noLocation: 'Choose a place on the map to see tide predictions.',
  sessionEnded: 'Your session has ended. Press Start display to continue.',
} as const;

export interface DisplayState {
  screen: 'start' | 'display';
  location?: DisplayLocation;
  findingLocation: boolean;
  message: string;
}

export interface DisplayDependencies {
  location?: DisplayLocation;
  findCurrentLocation: () => Promise<DisplayLocation | undefined>;
  saveLocation: (location: DisplayLocation) => void;
  chooseLocation: () => void;
  onStart: (location: DisplayLocation) => void;
  onChange: (state: DisplayState) => void;
}

/** Start/display lifecycle only. Session timing and tide rendering plug into its hooks separately. */
export class DisplayController {
  private state: DisplayState;
  private request = 0;

  constructor(private readonly dependencies: DisplayDependencies) {
    this.state = {
      screen: 'start',
      location: dependencies.location,
      findingLocation: false,
      message: dependencies.location ? locationLabel(dependencies.location) : START_MESSAGES.noLocation,
    };
  }

  view(): DisplayState {
    return { ...this.state, location: this.state.location && { ...this.state.location } };
  }

  async initialize(): Promise<void> {
    this.publish();
    if (!this.state.location) await this.useCurrentLocation();
  }

  async useCurrentLocation(): Promise<void> {
    if (this.state.location || this.state.findingLocation || this.state.screen !== 'start') return;
    const request = ++this.request;
    this.state = { ...this.state, findingLocation: true, message: START_MESSAGES.askingForLocation };
    this.publish();
    const location = await this.dependencies.findCurrentLocation().catch(() => undefined);
    if (request !== this.request) return;
    this.state = {
      ...this.state,
      location: location ?? this.state.location,
      findingLocation: false,
      message: location ? locationLabel(location) : this.state.location ? locationLabel(this.state.location) : START_MESSAGES.noLocation,
    };
    this.publish();
  }

  start(): void {
    if (this.state.screen === 'display') return;
    const location = this.state.location;
    if (!location) {
      this.chooseLocation();
      return;
    }
    // No late permission response may pull a running display back to the Start state.
    this.request++;
    try {
      this.dependencies.saveLocation(location);
    } catch {
      // Blocked/quota-limited device storage must not prevent this in-memory display session.
    }
    this.state = { ...this.state, screen: 'display', findingLocation: false, message: '' };
    this.publish();
    this.dependencies.onStart({ ...location });
  }

  chooseLocation(): void {
    this.request++;
    this.state = { ...this.state, findingLocation: false };
    this.dependencies.chooseLocation();
  }

  /** Called by the session-limit feature when its active display session expires. */
  sessionEnded(): void {
    this.request++;
    this.state = { ...this.state, screen: 'start', findingLocation: false, message: START_MESSAGES.sessionEnded };
    this.publish();
  }

  updateLocationName(stationId: string, name: string): void {
    const location = this.state.location;
    if (!location || location.stationId !== stationId) return;
    const namedLocation = { ...location, stationName: name };
    this.state = {
      ...this.state,
      location: namedLocation,
      message: this.state.screen === 'start' && this.state.message !== START_MESSAGES.sessionEnded
        ? locationLabel(namedLocation) : this.state.message,
    };
    this.publish();
  }

  private publish(): void {
    this.dependencies.onChange(this.view());
  }
}

export function locationLabel(location: DisplayLocation): string {
  return location.stationName ?? `Station ${location.stationId}`;
}
