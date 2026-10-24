/* Daily calories as a delta against that day's target: a diverging column
   chart around the target baseline. Intake is counted net of any exercise
   logged for the day. Plotting the difference rather than the absolute
   intake puts the whole plot on the question the reader is asking — how far
   off target was this day — instead of spending most of the ink on the
   ~1,800 kcal every day has in common. Intake, exercise and the net of the
   two stay one hover or one table row away. */

import { fmtInt, fmtSignedInt, parseISO } from '../format.js';
import { WEEKLY_THRESHOLD_DAYS, weeklyCalories } from '../stats.js';
import {
  MIN_HIT_WIDTH,
  attachCrosshair,
  barPath,
  createFrame,
  drawEmpty,
  drawXAxis,
  drawYAxis,
  linearScale,
  niceTicks,
  renderLegend,
  svg,
  token,
  tooltipDate,
} from './core.js';

const MAX_BAR_WIDTH = 24;
const SURFACE_GAP = 2;

export function caloriesSeries(points, daysInRange) {
  const weekly = daysInRange > WEEKLY_THRESHOLD_DAYS;
  return { points: weekly ? weeklyCalories(points) : points, weekly };
}

export function drawCaloriesChart({ width, props, tooltip }) {
  const { points, weekly, range } = props;
  const frame = createFrame({ width, label: 'Daily calories against target, net of exercise' });
  const { root, inner } = frame;

  if (!points.length) {
    drawEmpty(root, frame, 'No calories logged in this range yet.');
    return root;
  }

  const diffs = points.map((point) => point.diff);
  const ticks = niceTicks(Math.min(0, ...diffs), Math.max(0, ...diffs), 4);
  const yScale = linearScale([ticks.min, ticks.max], [inner.y1, inner.y0]);
  const xScale = linearScale(
    [parseISO(range.from).getTime(), parseISO(range.to).getTime()],
    [inner.x0, inner.x1]
  );
  const xOf = (index) => xScale(parseISO(points[index].iso).getTime());
  const zeroY = yScale(0);

  drawYAxis(root, { inner, scale: yScale, ticks: ticks.ticks, format: fmtSignedInt, title: 'kcal vs target' });
  drawXAxis(root, { inner, scale: xScale, fromISO: range.from, toISO: range.to });

  const colors = { under: token('--series-1'), over: token('--series-over') };
  const slot = (inner.x1 - inner.x0) / Math.max(1, points.length);
  const barWidth = Math.max(2, Math.min(MAX_BAR_WIDTH, slot - SURFACE_GAP));

  const bars = points.map((point, index) => {
    const x = xOf(index) - barWidth / 2;
    const y = yScale(point.diff);
    const over = point.diff > 0;
    // The rounded data-end is the one away from the target baseline.
    const d = over ? barPath(x, y, barWidth, zeroY - y) : barPath(x, zeroY, barWidth, -(y - zeroY));
    const node = svg('path', { class: 'bar', d, fill: over ? colors.over : colors.under });
    root.appendChild(node);
    return node;
  });

  // The target is the baseline itself; the y-axis title names the measure, so
  // no floating label is needed where it would collide with the columns.
  root.appendChild(svg('line', { class: 'axis-line', x1: inner.x0, x2: inner.x1, y1: zeroY, y2: zeroY }));

  let hovered = -1;
  attachCrosshair(root, {
    inner,
    xOf,
    count: points.length,
    showLine: false,
    onSelect: (index, x) => {
      if (hovered >= 0 && bars[hovered]) bars[hovered].classList.remove('bar--hover');
      bars[index].classList.add('bar--hover');
      hovered = index;
      const point = points[index];
      const over = point.diff > 0;
      const rows = [
        {
          color: over ? colors.over : colors.under,
          name: `kcal ${over ? 'over' : 'under'} target`,
          value: fmtInt(Math.abs(point.diff)),
        },
        { name: weekly ? 'eaten, daily average' : 'eaten', value: fmtInt(point.calories) },
      ];
      // Exercise rows only once there is exercise: an unlogged day should not
      // read as a logged zero.
      if (point.burned > 0) {
        rows.push(
          { name: weekly ? 'burnt, daily average' : 'burnt', value: `−${fmtInt(point.burned)}` },
          { name: weekly ? 'net, daily average' : 'net', value: fmtInt(point.net) }
        );
      }
      rows.push({ name: weekly ? 'target, daily average' : 'target', value: fmtInt(point.target) });
      if (weekly) rows.push({ name: 'days logged', value: String(point.days) });
      tooltip.show(x, Math.min(yScale(point.diff), zeroY), {
        title: weekly ? `Week of ${tooltipDate(point.iso)}` : tooltipDate(point.iso),
        rows,
      });
    },
    onClear: () => {
      if (hovered >= 0 && bars[hovered]) bars[hovered].classList.remove('bar--hover');
      hovered = -1;
      tooltip.hide();
    },
  });

  // Hit areas at least MIN_HIT_WIDTH wide, so thin columns stay reachable.
  const hitWidth = Math.max(MIN_HIT_WIDTH, barWidth + SURFACE_GAP * 2);
  points.forEach((point, index) => {
    root.appendChild(
      svg('rect', {
        x: xOf(index) - hitWidth / 2,
        y: inner.y0,
        width: hitWidth,
        height: inner.y1 - inner.y0,
        fill: 'transparent',
      })
    );
  });

  return root;
}

export function renderCaloriesLegend(container) {
  renderLegend(container, [
    { kind: 'rect', color: token('--series-1'), label: 'Under target' },
    { kind: 'rect', color: token('--series-over'), label: 'Over target' },
  ]);
}
