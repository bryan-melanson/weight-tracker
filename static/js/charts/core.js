/* SVG chart primitives: scales, ticks, axes, legends, tooltip and the
   pointer/keyboard readout layer shared by every chart in the app. */

import { fmtDateLong, fmtDateShort, fmtMonth, daysBetween, parseISO } from '../format.js';

const SVG_NS = 'http://www.w3.org/2000/svg';
export const MARGIN = { top: 18, right: 18, bottom: 26, left: 52 };
export const PLOT_HEIGHT = 196;
export const MIN_HIT_WIDTH = 24;

export function svg(name, attrs = {}, children = []) {
  const node = document.createElementNS(SVG_NS, name);
  Object.entries(attrs).forEach(([key, value]) => {
    if (value !== null && value !== undefined) node.setAttribute(key, String(value));
  });
  children.forEach((child) => node.appendChild(child));
  return node;
}

export function token(name) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim();
}

export function linearScale([d0, d1], [r0, r1]) {
  const span = (d1 - d0) || 1;
  const scale = (value) => r0 + ((value - d0) / span) * (r1 - r0);
  scale.invert = (pixel) => d0 + ((pixel - r0) / ((r1 - r0) || 1)) * span;
  return scale;
}

/* Round a value range outward to clean tick stops (1/2/5 × 10^n). */
export function niceTicks(min, max, targetCount = 5) {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return { min: 0, max: 1, ticks: [0, 1] };
  if (min === max) {
    const pad = Math.abs(min) > 1 ? Math.abs(min) * 0.05 : 1;
    min -= pad;
    max += pad;
  }
  const rawStep = (max - min) / targetCount;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalized = rawStep / magnitude;
  const step = (normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10) * magnitude;
  const niceMin = Math.floor(min / step) * step;
  const niceMax = Math.ceil(max / step) * step;
  const ticks = [];
  for (let value = niceMin; value <= niceMax + step / 1000; value += step) {
    ticks.push(Math.abs(value) < step / 1000 ? 0 : Number(value.toFixed(10)));
  }
  return { min: niceMin, max: niceMax, step, ticks };
}

/* Pick up to `count` evenly spaced dates from the range for the x axis. */
export function dateTicks(fromISO, toISOValue, count = 6) {
  const span = Math.max(1, daysBetween(fromISO, toISOValue));
  const stride = Math.max(1, Math.round(span / Math.max(1, count - 1)));
  const ticks = [];
  for (let offset = 0; offset <= span; offset += stride) {
    const date = parseISO(fromISO);
    date.setDate(date.getDate() + offset);
    ticks.push(date);
  }
  const last = parseISO(toISOValue);
  if (ticks.length && daysBetween(formatISO(ticks[ticks.length - 1]), toISOValue) > stride / 2) ticks.push(last);
  return { ticks, span };
}

function formatISO(date) {
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${date.getFullYear()}-${month}-${day}`;
}

export function createFrame({ width, height = PLOT_HEIGHT, margin = MARGIN, label }) {
  const totalHeight = height + margin.top + margin.bottom;
  const root = svg('svg', {
    viewBox: `0 0 ${width} ${totalHeight}`,
    width,
    height: totalHeight,
    role: 'img',
    'aria-label': label,
    tabindex: '0',
  });
  const inner = { x0: margin.left, x1: width - margin.right, y0: margin.top, y1: margin.top + height };
  return { root, inner, width, height: totalHeight };
}

export function drawYAxis(root, { inner, scale, ticks, format, title }) {
  ticks.forEach((value) => {
    const y = scale(value);
    if (y < inner.y0 - 0.5 || y > inner.y1 + 0.5) return;
    root.appendChild(svg('line', { class: 'grid-line', x1: inner.x0, x2: inner.x1, y1: y, y2: y }));
    root.appendChild(
      svg('text', { class: 'axis-text', x: inner.x0 - 8, y: y + 4, 'text-anchor': 'end' }, [
        document.createTextNode(format(value)),
      ])
    );
  });
  if (title) {
    root.appendChild(
      svg('text', { class: 'axis-title', x: inner.x0 - 8, y: inner.y0 - 7, 'text-anchor': 'start' }, [
        document.createTextNode(title),
      ])
    );
  }
}

export function drawXAxis(root, { inner, scale, fromISO, toISO, longLabels }) {
  root.appendChild(
    svg('line', { class: 'axis-line', x1: inner.x0, x2: inner.x1, y1: inner.y1, y2: inner.y1 })
  );
  const { ticks, span } = dateTicks(fromISO, toISO);
  const format = longLabels || span > 200 ? fmtMonth : fmtDateShort;
  ticks.forEach((date) => {
    const iso = formatISO(date);
    const x = scale(parseISO(iso).getTime());
    if (x < inner.x0 - 1 || x > inner.x1 + 1) return;
    root.appendChild(
      svg('text', { class: 'axis-text', x, y: inner.y1 + 16, 'text-anchor': 'middle' }, [
        document.createTextNode(format(iso)),
      ])
    );
  });
}

export function drawEmpty(root, { inner }, message) {
  root.appendChild(
    svg(
      'text',
      {
        class: 'empty-text',
        x: (inner.x0 + inner.x1) / 2,
        y: (inner.y0 + inner.y1) / 2,
        'text-anchor': 'middle',
      },
      [document.createTextNode(message)]
    )
  );
}

/* A dot with a 2px ring in the surface colour, so overlapping markers and
   line crossings stay legible. */
export function dot(x, y, color, radius = 4) {
  return svg('circle', {
    cx: x,
    cy: y,
    r: radius,
    fill: color,
    stroke: token('--surface'),
    'stroke-width': 2,
  });
}

export function linePath(points, color, { width = 2, dashed = false } = {}) {
  const d = points.map((point, index) => `${index ? 'L' : 'M'}${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ');
  return svg('path', {
    d,
    fill: 'none',
    stroke: color,
    'stroke-width': width,
    'stroke-linecap': 'round',
    'stroke-linejoin': 'round',
    'stroke-dasharray': dashed ? '5 4' : null,
  });
}

/* Column with a 4px rounded data-end and square corners at the baseline. */
export function barPath(x, y, width, height, radius = 4) {
  const r = Math.max(0, Math.min(radius, width / 2, Math.abs(height)));
  if (height >= 0) {
    return `M${x} ${y + height} L${x} ${y + r} Q${x} ${y} ${x + r} ${y} L${x + width - r} ${y} Q${x + width} ${y} ${x + width} ${y + r} L${x + width} ${y + height} Z`;
  }
  const bottom = y + Math.abs(height);
  return `M${x} ${y} L${x} ${bottom - r} Q${x} ${bottom} ${x + r} ${bottom} L${x + width - r} ${bottom} Q${x + width} ${bottom} ${x + width} ${bottom - r} L${x + width} ${y} Z`;
}

/* --- Legend --------------------------------------------------------------
   Always present for two or more series; keys mirror the mark (rect for
   fills, line for lines, dot for markers). Text never wears the data colour. */
export function renderLegend(container, items) {
  container.replaceChildren();
  items.forEach((item) => {
    const wrapper = document.createElement('span');
    wrapper.className = 'legend-item';
    const key = document.createElement('span');
    key.className = `legend-key legend-key--${item.kind || 'rect'}`;
    if (item.kind === 'dash') key.style.color = item.color;
    else key.style.background = item.color;
    const label = document.createElement('span');
    label.textContent = item.label;
    wrapper.append(key, label);
    container.appendChild(wrapper);
  });
}

/* --- Tooltip -------------------------------------------------------------
   Values lead, names follow. Labels are inserted as text nodes, never HTML. */
export function createTooltip(container) {
  const node = document.createElement('div');
  node.className = 'tooltip';
  node.hidden = true;
  container.appendChild(node);

  return {
    show(x, y, { title, rows }) {
      node.replaceChildren();
      if (title) {
        const head = document.createElement('div');
        head.className = 'tooltip__date';
        head.textContent = title;
        node.appendChild(head);
      }
      rows.forEach((row) => {
        const line = document.createElement('div');
        line.className = 'tooltip__row';
        if (row.color) {
          const key = document.createElement('span');
          key.className = 'legend-key legend-key--line';
          key.style.background = row.color;
          line.appendChild(key);
        }
        const value = document.createElement('span');
        value.className = 'tooltip__value';
        value.textContent = row.value;
        const name = document.createElement('span');
        name.className = 'tooltip__name';
        name.textContent = row.name;
        line.append(value, name);
        node.appendChild(line);
      });
      node.hidden = false;
      const bounds = container.getBoundingClientRect();
      const width = node.offsetWidth;
      const left = Math.max(4, Math.min(x + 14, bounds.width - width - 4));
      node.style.left = `${left}px`;
      node.style.top = `${Math.max(4, y - node.offsetHeight - 10)}px`;
    },
    hide() {
      node.hidden = true;
    },
  };
}

export const tooltipDate = fmtDateLong;

/* Pointer + keyboard readout for continuous charts: a crosshair snaps to the
   nearest sample so the reader aims at a date, never at a 2px line. Arrow
   keys give keyboard users the same readout. */
export function attachCrosshair(root, { inner, xOf, count, onSelect, onClear, showLine = true }) {
  if (!count) return;
  const line = svg('line', { class: 'crosshair', y1: inner.y0, y2: inner.y1, x1: 0, x2: 0, visibility: 'hidden' });
  if (showLine) root.appendChild(line);
  let active = -1;

  const select = (index) => {
    if (index < 0 || index >= count) return;
    active = index;
    const x = xOf(index);
    line.setAttribute('x1', x);
    line.setAttribute('x2', x);
    line.setAttribute('visibility', showLine ? 'visible' : 'hidden');
    onSelect(index, x);
  };
  const clear = () => {
    active = -1;
    line.setAttribute('visibility', 'hidden');
    onClear();
  };
  const nearest = (event) => {
    const bounds = root.getBoundingClientRect();
    const scale = root.viewBox.baseVal.width / bounds.width || 1;
    const pointerX = (event.clientX - bounds.left) * scale;
    let best = 0;
    let bestDistance = Infinity;
    for (let index = 0; index < count; index += 1) {
      const distance = Math.abs(xOf(index) - pointerX);
      if (distance < bestDistance) {
        bestDistance = distance;
        best = index;
      }
    }
    select(best);
  };

  root.addEventListener('pointermove', nearest);
  root.addEventListener('pointerdown', nearest);
  root.addEventListener('pointerleave', clear);
  root.addEventListener('blur', clear);
  root.addEventListener('focus', () => select(active < 0 ? count - 1 : active));
  root.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowRight') select(Math.min(count - 1, (active < 0 ? count - 1 : active) + 1));
    else if (event.key === 'ArrowLeft') select(Math.max(0, (active < 0 ? count - 1 : active) - 1));
    else if (event.key === 'Escape') clear();
    else return;
    event.preventDefault();
  });
}

/* Mount a chart into a plot container: re-renders on resize and on demand,
   holding the previous render until the new one is ready. */
export function mountChart(plotEl, draw) {
  const tooltip = createTooltip(plotEl);
  let props = null;
  let lastWidth = 0;

  const redraw = () => {
    if (!props) return;
    const width = Math.max(260, Math.round(plotEl.clientWidth || lastWidth || 640));
    lastWidth = width;
    tooltip.hide();
    const next = draw({ width, props, tooltip });
    plotEl.querySelectorAll('svg').forEach((node) => node.remove());
    plotEl.insertBefore(next, plotEl.firstChild);
  };

  let timer = null;
  const observer = new ResizeObserver(() => {
    if (Math.abs((plotEl.clientWidth || 0) - lastWidth) < 8) return;
    clearTimeout(timer);
    timer = setTimeout(redraw, 60);
  });
  observer.observe(plotEl);

  return {
    refresh(nextProps) {
      props = nextProps;
      redraw();
    },
  };
}
