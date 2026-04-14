/**
 * Effectiveness Scorer — deep-dashboard
 *
 * Calculates an overall harness effectiveness score (0–10) from four
 * dimensions sourced via the data collector.
 *
 * Missing dimensions redistribute their weight to available dimensions
 * (the "not_applicable" pattern), so the result always reflects the
 * proportion of the harness that is measurable.
 */

// ---------------------------------------------------------------------------
// Weight table
// ---------------------------------------------------------------------------

const WEIGHTS = {
  health:         0.25, // sensor clean ratio from health_report
  fitness:        0.20, // fitness rules pass ratio from deep-review/fitness.json
  session:        0.20, // recent quality_score (normalized 0-100 → 0-10)
  harnessability: 0.15, // already 0-10 from harnessability-report.json
  evolve:         0.20, // quality_score from deep-evolve receipt (normalized 0-100 → 0-10)
};

// ---------------------------------------------------------------------------
// Dimension extractors
// ---------------------------------------------------------------------------

/**
 * Extract a 0–10 health score from the health report inside deepReview
 * fitness data or deepWork receipts.
 *
 * The health dimension comes from sensor data: clean ratio of sensors.
 * We look for a sensors_clean_ratio field (0–1) on the fitness data and
 * multiply by 10, or fall back to null.
 */
function extractHealthScore(data) {
  // Try deep-review fitness.json for health_report section
  const fitness = data.deepReview?.fitness;
  if (fitness !== null && fitness !== undefined) {
    const ratio = fitness.sensors_clean_ratio ?? fitness.health?.sensors_clean_ratio ?? null;
    if (ratio !== null && typeof ratio === 'number') {
      return Math.min(10, Math.max(0, Math.round(ratio * 100) / 10));
    }
  }
  return null;
}

/**
 * Extract a 0–10 fitness score from deep-review fitness.json.
 *
 * Looks for rules_pass_ratio (0–1) → multiply by 10, or a pre-computed score.
 */
function extractFitnessScore(data) {
  const fitness = data.deepReview?.fitness;
  if (fitness === null || fitness === undefined) return null;

  const ratio = fitness.rules_pass_ratio ?? null;
  if (ratio !== null && typeof ratio === 'number') {
    return Math.min(10, Math.max(0, Math.round(ratio * 100) / 10));
  }

  // Pre-computed score field (0–10)
  const score = fitness.score ?? fitness.fitness_score ?? null;
  if (score !== null && typeof score === 'number') {
    return Math.min(10, Math.max(0, score));
  }

  // We have a fitness object but no usable numeric field
  return null;
}

/**
 * Extract a 0–10 session score from deep-work receipts.
 *
 * Averages the quality_score fields (assumed 0–100) across all receipts,
 * then normalizes to 0–10.
 */
function extractSessionScore(data) {
  const receipts = data.deepWork?.receipts;
  if (!Array.isArray(receipts) || receipts.length === 0) return null;

  // Spec §5.5: use last 3 sessions only
  const recent = receipts.slice(-3);
  const scores = recent
    .map((r) => r.quality_score ?? null)
    .filter((s) => s !== null && typeof s === 'number');

  if (scores.length === 0) return null;

  const avg = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  // Normalize 0-100 → 0-10, clamped
  return Math.min(10, Math.max(0, Math.round(avg) / 10));
}

/**
 * Extract a 0–10 harnessability score.
 *
 * The harnessability report's `total` field is already 0–10.
 */
function extractHarnessabilityScore(data) {
  const reportData = data.harnessability?.data;
  if (reportData === null || reportData === undefined) return null;

  const total = reportData.total ?? null;
  if (total !== null && typeof total === 'number') {
    return Math.min(10, Math.max(0, total));
  }
  return null;
}

/**
 * Extract a 0–10 evolve score from deep-evolve receipt.
 *
 * quality_score (0–100) is normalized to 0–10 via round-then-divide.
 * Returns null if receipt is absent or quality_score is not a finite number.
 */
function extractEvolveScore(data) {
  const receipt = data.deepEvolve?.receipt;
  if (receipt === null || receipt === undefined) return null;

  const qs = receipt.quality_score ?? null;
  if (qs !== null && typeof qs === 'number' && Number.isFinite(qs)) {
    return Math.min(10, Math.max(0, Math.round(qs) / 10));
  }
  return null;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Calculate an overall harness effectiveness score.
 *
 * @param {object} data — result from collectData()
 * @returns {{ effectiveness: number|null, scores: object }}
 */
export function calculateEffectiveness(data) {
  const rawScores = {
    health:         extractHealthScore(data),
    fitness:        extractFitnessScore(data),
    session:        extractSessionScore(data),
    harnessability: extractHarnessabilityScore(data),
    evolve:         extractEvolveScore(data),
  };

  // Determine which dimensions are available
  const available = Object.entries(rawScores).filter(([, v]) => v !== null);

  if (available.length === 0) {
    return { effectiveness: null, scores: rawScores };
  }

  // Redistribute weights to available dimensions only
  const totalAvailableWeight = available.reduce(
    (sum, [key]) => sum + WEIGHTS[key],
    0
  );

  let effectiveness = 0;
  for (const [key, score] of available) {
    const redistributedWeight = WEIGHTS[key] / totalAvailableWeight;
    effectiveness += score * redistributedWeight;
  }

  effectiveness = Math.round(effectiveness * 10) / 10;

  return { effectiveness, scores: rawScores };
}
