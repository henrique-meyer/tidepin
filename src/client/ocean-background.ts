import './ocean-background.css';
import { oceanLevelFraction, oceanSurfacePercent, type OceanTideData } from './ocean-level.js';

export type { OceanTideData } from './ocean-level.js';

export interface OceanBackground {
  /** Call with the same graph data on its existing refresh cadence; null is a neutral backdrop. */
  update(data: OceanTideData | null): void;
  destroy(): void;
}

/** Decorative only: no data request, clock or per-frame JavaScript. */
export function mountOceanBackground(root: HTMLElement): OceanBackground {
  const doc = root.ownerDocument;
  const element = doc.createElement('div');
  element.className = 'ocean-background';
  element.setAttribute('aria-hidden', 'true');
  element.dataset.state = 'neutral';
  const water = doc.createElement('div');
  water.className = 'ocean-water';
  const waves = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  waves.classList.add('ocean-waves');
  waves.setAttribute('viewBox', '0 0 2400 6');
  waves.setAttribute('preserveAspectRatio', 'none');
  waves.setAttribute('focusable', 'false');
  const surface = doc.createElementNS('http://www.w3.org/2000/svg', 'path');
  // Two identical 1200-unit sections: translating half the SVG repeats without a seam.
  surface.setAttribute('d', 'M0 3 C100 1 200 1 300 3 S500 5 600 3 S800 1 900 3 S1100 5 1200 3 S1400 1 1500 3 S1700 5 1800 3 S2000 1 2100 3 S2300 5 2400 3');
  surface.setAttribute('vector-effect', 'non-scaling-stroke');
  waves.append(surface);
  water.append(waves);
  element.append(water);
  const visibilityChanged = () => { element.dataset.motion = doc.hidden ? 'paused' : 'running'; };
  visibilityChanged();
  doc.addEventListener('visibilitychange', visibilityChanged);
  const hadHostClass = root.classList.contains('ocean-background-host');
  root.classList.add('ocean-background-host');
  root.prepend(element);
  let destroyed = false;
  let previous: number | null | undefined;

  return {
    update(data) {
      if (destroyed) return;
      const fraction = oceanLevelFraction(data);
      if (fraction === previous) return;
      previous = fraction;
      element.dataset.state = fraction === null ? 'neutral' : 'tide';
      water.style.setProperty('--ocean-surface', `${oceanSurfacePercent(fraction)}%`);
    },
    destroy() {
      destroyed = true;
      doc.removeEventListener('visibilitychange', visibilityChanged);
      element.remove();
      if (!hadHostClass) root.classList.remove('ocean-background-host');
    },
  };
}
