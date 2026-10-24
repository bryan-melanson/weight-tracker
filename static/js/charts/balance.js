/* Running calorie balance: the cumulative sum of (eaten − burnt − target).
   Below the zero line is a deficit, above it a surplus — a diverging read
   around one baseline, on a single axis. */

import { KCAL_PER_KG, fmtSignedInt, fmtWeightDelta, parseISO } from '../format.js';
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

const AREA_OPACITY = 0.1;

export function drawBalanceChart({ width, props, tooltip }) {
  const { balance, settings, range } = props;
  const frame = createFrame({ width, label: 'Cumulative calories against target, net of exercise' });
  const { root, inner } = frame;

  if (!balance.length) {
    drawEmpty(root, frame, 'Log calories to see the running balance.');
    return root;
  }

  const values = balance.map((point) => point.kcal);
  const ticks = niceTicks(Math.min(0, ...values), Math.max(0, ...values), 4);
  const yScale = linearScale([ticks.min, ticks.max], [inner.y1, inner.y0]);
  const xScale = linearScale(
    [parseISO(range.from).getTime(), parseISO(range.to).getTime()],
    [inner.x0, inner.x1]
  );
  const xOf = (index) => xScale(parseISO(balance[index].iso).getTime());
  const zeroY = yScale(0);

  drawYAxis(root, { inner, scale: yScale, ticks: ticks.ticks, format: fmtSignedInt, title: 'kcal' });
  drawXAxis(root, { inner, scale: xScale, fromISO: range.from, toISO: range.to });

  const colors = { deficit: token('--series-1'), surplus: token('--series-over') };
  const linePoints = balance.map((point, index) => ({ x: xOf(index), y: yScale(point.kcal) }));

  // Two clipped copies of the same area: one below the zero line, one above,
  // so the sign of the balance is legible without a second axis.
  const defs = svg('defs');
  const clips = [
    { id: 'clip-deficit', y: zeroY, height: Math.max(0, inner.y1 - zeroY), color: colors.deficit },
    { id: 'clip-surplus', y: inner.y0, height: Math.max(0, zeroY - inner.y0), color: colors.surplus },
  ];
  clips.forEach((clip) => {
    defs.appendChild(
      svg('clipPath', { id: clip.id }, [
        svg('rect', { x: inner.x0, y: clip.y, width: inner.x1 - inner.x0, height: clip.height }),
      ])
    );
  });
  root.appendChild(defs);

  const areaD = [
    `M${linePoints[0].x} ${zeroY}`,
    ...linePoints.map((point) => `L${point.x.toFixed(2)} ${point.y.toFixed(2)}`),
    `L${linePoints[linePoints.length - 1].x} ${zeroY}`,
    'Z',
  ].join(' ');
  clips.forEach((clip) => {
    root.appendChild(
      svg('path', { d: areaD, fill: clip.color, 'fill-opacity': AREA_OPACITY, 'clip-path': `url(#${clip.id})` })
    );
  });

  root.appendChild(svg('line', { class: 'axis-line', x1: inner.x0, x2: inner.x1, y1: zeroY, y2: zeroY }));
  if (linePoints.length > 1) root.appendChild(linePath(linePoints, colors.deficit));

  const last = balance[balance.length - 1];
  const lastPoint = linePoints[linePoints.length - 1];
  root.appendChild(dot(lastPoint.x, lastPoint.y, last.kcal > 0 ? colors.surplus : colors.deficit));
  const labelX = Math.min(inner.x1 - 2, lastPoint.x + 8);
  root.appendChild(
    svg(
      'text',
      {
        class: 'data-label',
        x: labelX,
        y: Math.max(inner.y0 + 10, lastPoint.y - 14),
        'text-anchor': labelX > inner.x1 - 72 ? 'end' : 'start',
      },
      [document.createTextNode(`${fmtSignedInt(last.kcal)} kcal`)]
    )
  );

  attachCrosshair(root, {
    inner,
    xOf,
    count: balance.length,
    onSelect: (index, x) => {
      const point = balance[index];
      tooltip.show(x, yScale(point.kcal), {
        title: tooltipDate(point.iso),
        rows: [
          {
            color: point.kcal > 0 ? colors.surplus : colors.deficit,
            name: point.kcal > 0 ? 'cumulative surplus' : 'cumulative deficit',
            value: `${fmtSignedInt(point.kcal)} kcal`,
          },
          {
            name: 'equivalent body mass',
            value: fmtWeightDelta(point.kcal / KCAL_PER_KG, settings.unit, { places: 2 }),
          },
        ],
      });
    },
    onClear: () => tooltip.hide(),
  });

  return root;
}

export function renderBalanceLegend(container) {
  renderLegend(container, [
    { kind: 'rect', color: token('--series-1'), label: 'Cumulative deficit (below 0)' },
    { kind: 'rect', color: token('--series-over'), label: 'Cumulative surplus (above 0)' },
  ]);
}
