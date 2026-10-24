/* The KPI row: one hero figure (current weight) plus supporting stat tiles.
   Every tile is scoped to the selected range, like the charts below it. */

import { KCAL_PER_KG, fmtDateLong, fmtInt, fmtSignedInt, fmtWeight, fmtWeightDelta } from './format.js';

/* Is losing weight the improving direction? Decided by the goal, not assumed. */
function improvingSign(settings, currentKg) {
  const goal = settings.goal_weight_kg;
  if (goal === null || currentKg === null) return 0;
  return goal < currentKg ? -1 : 1;
}

const EMPTY = '—';

function tile({ label, value, delta, deltaKind, hero }) {
  const node = document.createElement('div');
  node.className = hero ? 'kpi kpi--hero' : 'kpi';

  const labelEl = document.createElement('p');
  labelEl.className = 'kpi__label';
  labelEl.textContent = label;

  const valueEl = document.createElement('p');
  valueEl.className = value === EMPTY ? 'kpi__value kpi__value--empty' : 'kpi__value';
  valueEl.textContent = value;

  node.append(labelEl, valueEl);
  if (delta) {
    const deltaEl = document.createElement('p');
    deltaEl.className = 'kpi__delta';
    deltaEl.textContent = delta;
    if (deltaKind === 'good') deltaEl.style.color = 'var(--good)';
    if (deltaKind === 'bad') deltaEl.style.color = 'var(--series-over)';
    node.appendChild(deltaEl);
  }
  return node;
}

function changeTile(summary, settings, rangeLabel) {
  const { changeKg, current } = summary;
  if (changeKg === null) {
    return { delta: current ? `Logged ${fmtDateLong(current.iso)}` : 'No weight logged yet', deltaKind: null };
  }
  const sign = improvingSign(settings, current.kg);
  const moved = Math.sign(changeKg);
  const kind = sign === 0 || moved === 0 ? null : moved === sign ? 'good' : 'bad';
  return { delta: `${fmtWeightDelta(changeKg, settings.unit)} over ${rangeLabel}`, deltaKind: kind };
}

function goalTile(summary, settings) {
  if (settings.goal_weight_kg === null) {
    return tile({ label: 'To goal', value: EMPTY, delta: 'Set a goal weight in Targets' });
  }
  const remaining = summary.goalRemainingKg;
  if (remaining === null) {
    return tile({ label: 'To goal', value: fmtWeight(settings.goal_weight_kg, settings.unit), delta: 'Log a weight to compare' });
  }
  if (Math.abs(remaining) < 0.05) {
    return tile({ label: 'To goal', value: 'Reached', delta: `Goal ${fmtWeight(settings.goal_weight_kg, settings.unit)}`, deltaKind: 'good' });
  }
  const projection = summary.projection;
  const delta = projection && projection.iso
    ? `On the current trend, about ${fmtDateLong(projection.iso)}`
    : `Goal ${fmtWeight(settings.goal_weight_kg, settings.unit)}`;
  return tile({
    label: remaining < 0 ? 'To goal (to lose)' : 'To goal (to gain)',
    value: fmtWeight(Math.abs(remaining), settings.unit),
    delta,
  });
}

function caloriesTile(summary) {
  const { avgCalories, avgDiff } = summary;
  if (avgCalories === null) {
    return tile({ label: 'Eaten, 7-day average', value: EMPTY, delta: 'No calories logged in range' });
  }
  const over = avgDiff > 0;
  return tile({
    label: 'Eaten, 7-day average',
    value: fmtInt(avgCalories),
    delta: `${fmtSignedInt(avgDiff)} kcal/day vs target, net of exercise`,
    deltaKind: avgDiff === null ? null : over ? 'bad' : 'good',
  });
}

/* Exercise, averaged over the days it was logged rather than over the range:
   a blank day is an unknown, not a rest day, so averaging over the range
   would quietly understate every week with a gap in it. */
function exerciseTile(summary) {
  if (summary.avgBurned === null) {
    return tile({ label: 'Exercise, daily average', value: EMPTY, delta: 'No exercise logged in range' });
  }
  return tile({
    label: 'Exercise, daily average',
    value: `${fmtInt(summary.avgBurned)} kcal`,
    delta: `${fmtInt(summary.totalBurned)} kcal over ${summary.burnDays} logged day${summary.burnDays === 1 ? '' : 's'}`,
  });
}

function balanceTile(summary, settings) {
  if (summary.netKcal === null) {
    return tile({ label: 'Running balance', value: EMPTY, delta: 'No calories logged in range' });
  }
  return tile({
    label: 'Running balance',
    value: `${fmtSignedInt(summary.netKcal)} kcal`,
    delta: `≈ ${fmtWeightDelta(summary.netKg, settings.unit, { places: 2 })} at ${KCAL_PER_KG.toLocaleString()} kcal/kg`,
  });
}

export function renderKpis(container, summary, settings, rangeLabel) {
  const change = changeTile(summary, settings, rangeLabel);
  const tiles = [
    tile({
      label: 'Current weight',
      value: summary.current ? fmtWeight(summary.current.kg, settings.unit) : EMPTY,
      delta: change.delta,
      deltaKind: change.deltaKind,
      hero: true,
    }),
    goalTile(summary, settings),
    caloriesTile(summary),
    exerciseTile(summary),
    balanceTile(summary, settings),
    tile({
      label: 'Days logged',
      value: `${summary.daysLogged}`,
      delta: summary.daysInRange ? `of ${summary.daysInRange} days in range` : null,
    }),
  ];
  container.replaceChildren(...tiles);
}
