/* Weight over time: logged points, a 7-day trailing average, and the goal
   as a labelled reference line. Single measure, one y axis. */

import { fmtWeight, parseISO, roundTo, toDisplayWeight } from '../format.js';
import { TREND_WINDOW_DAYS, trailingAverage } from '../stats.js';
import {
  attachCrosshair,
  createFrame,
  dot,
  drawEmpty,
  drawXAxis,
  drawYAxis,
  linePath,
  linearScale,
  niceTicks,
  renderLegend,
  svg,
  token,
  tooltipDate,
} from './core.js';

const MAX_VISIBLE_DOTS = 120;
/* How far outside the data the goal line may pull the y axis before it would
   flatten the trend; past this it is reported in the note instead. */
const GOAL_SPAN_ALLOWANCE = 0.6;

export function drawWeightChart({ width, props, tooltip }) {
  const { weights, settings, range } = props;
  const unit = settings.unit;
  const frame = createFrame({ width, label: 'Weight over time' });
  const { root, inner } = frame;

  if (!weights.length) {
    drawEmpty(root, frame, 'No weight logged in this range yet.');
    return root;
  }

  const trend = trailingAverage(weights, TREND_WINDOW_DAYS);
  const values = weights.map((point) => point.kg);
  let low = Math.min(...values);
  let high = Math.max(...values);
  const goal = settings.goal_weight_kg;
  const goalFits = goalFitsView(weights, goal);
  if (goalFits) {
    low = Math.min(low, goal);
    high = Math.max(high, goal);
  }

  const display = (kg) => toDisplayWeight(kg, unit);
  const ticks = niceTicks(display(low), display(high), 4);
  const yScale = linearScale([ticks.min, ticks.max], [inner.y1, inner.y0]);
  const xScale = linearScale(
    [parseISO(range.from).getTime(), parseISO(range.to).getTime()],
    [inner.x0, inner.x1]
  );
  const xOf = (index) => xScale(parseISO(weights[index].iso).getTime());

  drawYAxis(root, {
    inner,
    scale: yScale,
    ticks: ticks.ticks,
    format: (value) => roundTo(value, 1).toFixed(1),
    title: unit,
  });
  drawXAxis(root, { inner, scale: xScale, fromISO: range.from, toISO: range.to });

  const colors = {
    trend: token('--series-1'),
    goal: token('--series-goal'),
    point: token('--text-muted'),
  };

  if (goalFits) {
    const y = yScale(display(goal));
    root.appendChild(linePath([{ x: inner.x0, y }, { x: inner.x1, y }], colors.goal, { width: 2, dashed: true }));
    root.appendChild(
      svg('text', { class: 'ref-label', x: inner.x0 + 2, y: y - 6 }, [
        document.createTextNode(`Goal ${fmtWeight(goal, unit)}`),
      ])
    );
  }

  const trendPoints = trend.map((point, index) => ({ x: xOf(index), y: yScale(display(point.kg)) }));
  if (trendPoints.length > 1) root.appendChild(linePath(trendPoints, colors.trend));

  const showDots = weights.length <= MAX_VISIBLE_DOTS;
  weights.forEach((point, index) => {
    if (!showDots && index !== weights.length - 1) return;
    root.appendChild(dot(xOf(index), yScale(display(point.kg)), index === weights.length - 1 ? colors.trend : colors.point));
  });

  // One direct label: the latest reading, at the end of the line.
  const lastIndex = weights.length - 1;
  const labelX = Math.min(inner.x1 - 2, xOf(lastIndex) + 8);
  root.appendChild(
    svg(
      'text',
      {
        class: 'data-label',
        x: labelX,
        y: yScale(display(weights[lastIndex].kg)) - 10,
        'text-anchor': labelX > inner.x1 - 48 ? 'end' : 'start',
      },
      [document.createTextNode(fmtWeight(weights[lastIndex].kg, unit))]
    )
  );

  attachCrosshair(root, {
    inner,
    xOf,
    count: weights.length,
    onSelect: (index, x) => {
      const rows = [{ color: colors.point, name: 'logged', value: fmtWeight(weights[index].kg, unit) }];
      if (trend[index].samples > 1) {
        rows.push({
          color: colors.trend,
          name: `${TREND_WINDOW_DAYS}-day avg`,
          value: fmtWeight(trend[index].kg, unit),
        });
      }
      tooltip.show(x, yScale(display(weights[index].kg)), { title: tooltipDate(weights[index].iso), rows });
    },
    onClear: () => tooltip.hide(),
  });

  return root;
}

/* The goal line is only drawn when it sits near the data; pulling the axis to
   a distant goal would flatten the trend the chart exists to show. */
export function goalFitsView(weights, goal) {
  if (goal === null || goal === undefined || !weights.length) return false;
  const values = weights.map((point) => point.kg);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  return goal >= low - span * GOAL_SPAN_ALLOWANCE && goal <= high + span * GOAL_SPAN_ALLOWANCE;
}

export function weightLegend(settings, { goalDrawn }) {
  const items = [
    { kind: 'dot', color: token('--text-muted'), label: 'Logged weight' },
    { kind: 'line', color: token('--series-1'), label: `${TREND_WINDOW_DAYS}-day average` },
  ];
  if (goalDrawn) items.push({ kind: 'dash', color: token('--series-goal'), label: `Goal ${fmtWeight(settings.goal_weight_kg, settings.unit)}` });
  return items;
}

export function renderWeightLegend(container, settings, goalDrawn) {
  renderLegend(container, weightLegend(settings, { goalDrawn }));
}
