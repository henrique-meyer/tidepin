/// <reference types="google.maps" />
import type { Coordinates } from './location-settings.js';

export interface Suggestion { main: string; secondary: string }
export interface PlacesBackend<S extends Suggestion, Token> {
  createSessionToken(): Token;
  suggest(input: string, sessionToken: Token): Promise<S[]>;
  locate(suggestion: S): Promise<Coordinates | undefined>;
}
export interface PlaceSearchOptions<S> {
  onSuggestions(suggestions: S[]): void;
  onError(): void;
  debounceMs?: number;
  minChars?: number;
}

/** ArrowUp enters an unselected list at its last item, then wraps normally. */
export function previousSuggestionIndex(active: number, count: number): number {
  if (count < 1) return -1;
  return active < 0 ? count - 1 : (active - 1 + count) % count;
}

/** BoltClock's session/debounce approach; text and suggestions exist only in memory. */
export class PlaceSearch<S extends Suggestion, Token> {
  private token: Token | undefined;
  private timer: ReturnType<typeof setTimeout> | undefined;
  private generation = 0;
  constructor(private readonly backend: PlacesBackend<S, Token>, private readonly options: PlaceSearchOptions<S>) {}

  input(text: string): void {
    this.cancelPending();
    const query = text.trim();
    if (!query) this.token = undefined;
    if (query.length < (this.options.minChars ?? 3)) { this.options.onSuggestions([]); return; }
    const generation = this.generation;
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.token ??= this.backend.createSessionToken();
      void this.backend.suggest(query, this.token).then(
        suggestions => { if (generation === this.generation) this.options.onSuggestions(suggestions); },
        () => { if (generation === this.generation) this.options.onError(); },
      );
    }, this.options.debounceMs ?? 400);
  }

  async choose(suggestion: S): Promise<Coordinates | undefined> {
    this.cancelPending();
    this.token = undefined;
    this.options.onSuggestions([]);
    const generation = this.generation;
    const point = await this.backend.locate(suggestion);
    return generation === this.generation ? point : undefined;
  }

  cancelPending(): void {
    this.generation++;
    if (this.timer !== undefined) clearTimeout(this.timer);
    this.timer = undefined;
  }
}

export interface GoogleSuggestion extends Suggestion { prediction: google.maps.places.PlacePrediction }
export function googlePlacesBackend(
  places: Pick<google.maps.PlacesLibrary, 'AutocompleteSuggestion' | 'AutocompleteSessionToken'>,
): PlacesBackend<GoogleSuggestion, google.maps.places.AutocompleteSessionToken> {
  return {
    createSessionToken: () => new places.AutocompleteSessionToken(),
    async suggest(input, sessionToken) {
      const { suggestions } = await places.AutocompleteSuggestion.fetchAutocompleteSuggestions({ input, sessionToken });
      return suggestions.flatMap(({ placePrediction: prediction }) => prediction
        ? [{ prediction, main: (prediction.mainText ?? prediction.text).text, secondary: prediction.secondaryText?.text ?? '' }] : []);
    },
    async locate({ prediction }) {
      const place = prediction.toPlace();
      await place.fetchFields({ fields: ['location'] });
      return place.location ? { latitude: place.location.lat(), longitude: place.location.lng() } : undefined;
    },
  };
}
