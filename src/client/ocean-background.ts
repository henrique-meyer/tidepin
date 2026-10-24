import './ocean-background.css';
import { oceanLevelFraction, oceanSurfacePercent, type OceanTideData } from './ocean-level.js';

export type { OceanTideData } from './ocean-level.js';

export interface OceanBackground {
  /** Call with the same graph data on its existing refresh cadence; null is a neutral backdrop. */
  update(data: OceanTideData | null): void;
  destroy(): void;
}

/** Decorative only: it neither requests data nor starts a clock or animation loop. */
export function mountOceanBackground(root: HTMLElement): OceanBackground {
  const element = root.ownerDocument.createElement('div');
  element.className = 'ocean-background';
  element.setAttribute('aria-hidden', 'true');
  element.dataset.state = 'neutral';
  const water = root.ownerDocument.createElement('div');
  water.className = 'ocean-water';
  element.append(water);
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
      element.remove();
      if (!hadHostClass) root.classList.remove('ocean-background-host');
    },
  };
}
