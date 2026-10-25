import './graph.css';
import { buildChartData, formatStationTime, stationDayWindow, type TideEvent } from '../shared/tides.js';
import type { DisplaySettings } from './display-settings.js';
import { createGraphController, type GraphState } from './graph-controller.js';
import { chartGeometry, displayHeight, eventLabelPositions, localClock, stationTicks } from './graph-model.js';
import { graphRefreshFeedback } from './graph-feedback.js';

export type ChartData = Pick<ReturnType<typeof buildChartData>, 'chartPoints' | 'current'>;
export interface GraphOptions { onChartData?: (data: ChartData | null) => void; onStation?: (name: string, stationId: string) => void }
const escape = (value: string) => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');

export function mountTideGraph(root: HTMLElement, options: GraphOptions = {}) {
  root.classList.add('tide-graph');
  let lastState: GraphState | undefined;
  function render(state: GraphState) {
    lastState = state;
    const { data, preferences, now, loading, error } = state;
    const feedback = graphRefreshFeedback(state);
    if (!data) {
      options.onChartData?.(null);
      root.innerHTML = loading
        ? '<div class="graph-state" role="status"><span class="graph-spinner" aria-hidden="true"></span><p>Loading NOAA predictions…</p></div>'
        : error ? `<div class="graph-state" role="status"><p><span aria-hidden="true">⚠ </span>${escape(error)}</p><button type="button" class="graph-retry" aria-busy="${feedback.busy}" ${feedback.disabled ? 'disabled' : ''}>Retry predictions</button></div>` : '';
      root.querySelector('button')?.addEventListener('click', () => { void controller.refresh(true); });
      return;
    }
    const zone = data.station.timeZoneId!;
    const currentDay = stationDayWindow(now, zone);
    const isToday = currentDay?.start === data.window.start && currentDay.end === data.window.end;
    const products = data.predictions;
    const waitText = feedback.waitSeconds ? ` Please wait ${feedback.waitSeconds} seconds before retrying.` : '';
    if (!products.curve.data?.length && !products.events.data?.length) {
      options.onChartData?.(null);
      const message = products.curve.status === 'error' || products.events.status === 'error'
        ? 'NOAA predictions are unavailable. No saved predictions cover this day.'
        : 'No NOAA tide predictions are available for this station and day.';
      root.innerHTML = `<div class="graph-state" role="status"><p><span aria-hidden="true">⚠ </span>${message}${escape(waitText)}</p><button class="graph-retry" type="button" aria-busy="${feedback.busy}" ${feedback.disabled ? 'disabled' : ''}>Retry predictions</button></div>`;
      root.querySelector('button')?.addEventListener('click', () => { void controller.refresh(true); });
      return;
    }
    const curveSource = products.curveSource ?? (products.curve.status === 'unsupported' ? 'estimatedExtremes' : 'sixMinute');
    const estimated = curveSource === 'estimatedExtremes';
    const chart = buildChartData(products.curve.data ?? [], products.events.data ?? [], data.window, now, isToday, curveSource);
    options.onChartData?.(chart.chartPoints.length || chart.current ? { chartPoints: chart.chartPoints.map(row => ({ ...row })), current: chart.current ? { ...chart.current } : null } : null);
    options.onStation?.(data.station.name, data.station.id);
    const unit = preferences.heightUnit;
    const hour12 = preferences.clockFormat === '12h';
    const time = (instant: number, date = false) => formatStationTime(instant, zone, hour12, date) ?? 'Time unavailable';
    const height = (meters: number) => `${displayHeight(meters, unit)} ${unit}`;
    const date = new Intl.DateTimeFormat('en-US', { timeZone: zone, weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }).format(data.window.start * 1000);
    const fetched = [products.curve.fetchedAt, products.events.fetchedAt].filter((value): value is number => value !== null);
    const updated = fetched.length ? `Updated ${time(Math.min(...fetched))}` : 'No saved predictions';
    const eventCard = (event: TideEvent | null, kind: 'High' | 'Low') => `<article class="graph-card graph-event"><h3>${kind === 'High' ? '↑' : '↓'} Next ${kind.toLowerCase()}</h3><p class="graph-event-time">${event ? escape(localClock(event.time, zone, hour12)) : '—'}</p><p>${event ? escape(height(event.heightMeters)) : 'Unavailable'}</p>${event ? `<p class="graph-footnote">${escape(time(event.time, true))}</p>` : ''}</article>`;
    let chartMarkup: string;
    if (!chart.chartPoints.length || estimated && !chart.segments.some(segment => segment.length > 1)) chartMarkup = `<div class="graph-state graph-card"><p>${estimated ? 'Not enough predicted highs and lows to estimate a curve for this day.' : 'No curve predictions are available for this day.'}</p></div>`;
    else {
      const width = Math.max(260, root.clientWidth - 24);
      const svgHeight = width < 600 ? 200 : Math.min(360, Math.max(200, window.innerHeight - 820));
      const geometry = chartGeometry(chart, data.window, unit, width, svgHeight);
      const bottom = svgHeight - 26;
      const grid = geometry.ticks.map(tick => {
        const meters = unit === 'ft' ? tick * 0.3048 : tick;
        const y = geometry.y(meters);
        return `<line class="${tick === 0 ? 'graph-zero' : 'graph-grid'}" x1="40" x2="${width - 12}" y1="${y}" y2="${y}"/><text class="graph-axis" x="34" y="${y + 4}" text-anchor="end">${tick.toString().replace('-', '−')} ${unit}</text>`;
      }).join('');
      const paths = chart.segments.map(rows => {
        const path = geometry.path(rows);
        const fill = `${path} L${geometry.x(rows.at(-1)!.time)},${bottom} L${geometry.x(rows[0]!.time)},${bottom} Z`;
        return `<path class="graph-fill" d="${fill}"/><path class="graph-curve" d="${path}"/>`;
      }).join('');
      const markers = chart.markers.map(event => `<circle class="${event.type === 'H' ? 'graph-high' : 'graph-low'}" cx="${geometry.x(event.time)}" cy="${geometry.y(event.heightMeters)}" r="${event.type === 'H' ? 5 : 4}"><title>${event.type === 'H' ? 'High' : 'Low'}: ${escape(height(event.heightMeters))}, ${escape(time(event.time, true))}</title></circle>`).join('');
      const eventLabels = eventLabelPositions(chart.markers, geometry.x, geometry.y, width, svgHeight, instant => localClock(instant, zone, hour12))
        .map(label => `<text class="graph-event-label" x="${label.x}" y="${label.y}" text-anchor="middle">${escape(label.text)}</text>`).join('');
      const ticks = stationTicks(data.window, zone, hour12).map((tick, index, all) => `<text class="graph-axis" x="${geometry.x(tick.time)}" y="${svgHeight - 5}" text-anchor="${index === 0 ? 'start' : index === all.length - 1 ? 'end' : 'middle'}">${escape(tick.label)}</text>`).join('');
      let marker = '';
      if (isToday && chart.current && now >= data.window.start && now < data.window.end) {
        const x = geometry.x(now);
        const pill = Math.max(40, Math.min(width - 72, x - 30));
        marker = `<g><title>Now${estimated ? ' (estimated)' : ''}: ${escape(time(now))}</title><line class="graph-now-line" x1="${x}" x2="${x}" y1="22" y2="${bottom}"/><rect class="graph-now-pill" x="${pill}" y="1" width="60" height="16" rx="8"/><text class="graph-now-label" x="${pill + 30}" y="13" text-anchor="middle">${escape(localClock(now, zone, hour12))}</text><circle class="graph-now-dot" cx="${x}" cy="${geometry.y(chart.current.heightMeters)}" r="6"/></g>`;
      }
      chartMarkup = `<figure class="graph-card graph-chart"><svg viewBox="0 0 ${width} ${svgHeight}" role="img" aria-label="${escape(`${estimated ? 'Estimated tide curve from NOAA predicted highs and lows' : 'NOAA tide predictions'} in ${unit}, ${date}, ${zone}. ${chart.current ? `Current ${estimated ? 'estimated' : 'predicted'} height ${height(chart.current.heightMeters)} at ${time(now)}.` : 'Current height unavailable.'} High and low details follow in the table.`)}">${grid}${paths}${markers}${eventLabels}${marker}${ticks}</svg><figcaption class="graph-footnote">${estimated ? '<span class="graph-estimate-note">Curve estimated from predicted highs and lows.</span> ' : ''}${escape(zone)} · MLLW · NOAA CO-OPS</figcaption></figure>`;
    }
    const rows = chart.markers.map(event => `<tr><th scope="row">${event.type === 'H' ? '↑ High' : '↓ Low'}</th><td>${escape(time(event.time))}</td><td class="graph-table-height">${escape(height(event.heightMeters))}</td></tr>`).join('');
    root.innerHTML = `<p class="graph-meta">${escape(date)} · Station ${escape(data.station.id)}<br>${escape(updated)}</p>
      <article class="graph-card graph-current"><div><h3>${estimated ? 'Estimated' : 'Predicted'} height now</h3><p class="graph-current-value">${chart.current ? escape(height(chart.current.heightMeters)) : '—'}</p></div><div class="graph-current-context"><p>${escape(time(now))}</p><p class="graph-footnote">${escape(zone)} · MLLW</p>${!chart.current ? '<p class="graph-footnote">Current height unavailable</p>' : ''}</div></article>
      <div class="graph-events">${eventCard(chart.nextHigh, 'High')}${eventCard(chart.nextLow, 'Low')}</div>
      ${chartMarkup}<section class="graph-table-section"><h3>High &amp; low tides</h3><div class="graph-table-scroll"><table><caption class="graph-sr-only">${escape(date)}, ${escape(zone)}, predicted heights relative to MLLW</caption><thead><tr><th scope="col">Event</th><th scope="col">Station time</th><th scope="col">Height (${unit})</th></tr></thead><tbody>${rows || `<tr><td colspan="3">${products.events.data === null ? 'High/low predictions are unavailable.' : 'No high or low tides in this day.'}</td></tr>`}</tbody></table></div></section>
      <div class="graph-refresh"><p class="graph-status graph-footnote" role="status">${feedback.warning ? '<span aria-hidden="true">⚠&nbsp;</span>' : ''}${escape(feedback.message || 'Predicted heights relative to MLLW. Not for navigation.')}</p><button class="graph-retry" type="button" aria-busy="${feedback.busy}" ${feedback.disabled ? 'disabled' : ''}>Refresh predictions</button></div>`;
    root.querySelector('button')?.addEventListener('click', () => { void controller.refresh(true); });
  }
  const controller = createGraphController({ render, visible: () => !document.hidden, sessionActive: () => document.body.dataset.displayState === 'display' });
  const resize = new ResizeObserver(() => { if (lastState?.data) render(lastState); });
  resize.observe(root);
  return { ...controller, destroy() { resize.disconnect(); controller.destroy(); root.replaceChildren(); } };
}

export function setupTideGraph(options: GraphOptions = {}) {
  const root = document.querySelector<HTMLElement>('#tide-chart');
  if (!root) throw new Error('The tide display requires a graph mount.');
  const graph = mountTideGraph(root, options);
  const start = (event: Event) => { const { location, preferences } = (event as CustomEvent<{ location: { stationId: string }; preferences: DisplaySettings }>).detail; graph.start(location, preferences); };
  const preferences = (event: Event) => graph.setPreferences((event as CustomEvent<{ preferences: DisplaySettings }>).detail.preferences);
  const stop = () => graph.stop();
  const visibility = () => graph.visibilityChanged();
  window.addEventListener('tidepin:display-start', start);
  window.addEventListener('tidepin:preferences-changed', preferences);
  window.addEventListener('tidepin:session-ended', stop);
  document.addEventListener('visibilitychange', visibility);
  return { ...graph, destroy() { window.removeEventListener('tidepin:display-start', start); window.removeEventListener('tidepin:preferences-changed', preferences); window.removeEventListener('tidepin:session-ended', stop); document.removeEventListener('visibilitychange', visibility); graph.destroy(); } };
}
