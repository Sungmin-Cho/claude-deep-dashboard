/**
 * Action Router — deep-dashboard
 *
 * Maps findings from collector data to suggested actions.
 * Sources findings from deep-review fitness rules and health sensors.
 */

// ---------------------------------------------------------------------------
// Action map
// ---------------------------------------------------------------------------

const ACTION_MAP = {
  'dependency-vuln':  { action: 'npm audit fix',                                         category: 'health'   },
  'dead-export':      { action: 'Remove unused export or add to health-ignore.json',      category: 'health'   },
  'stale-config':     { action: 'Fix broken config references',                           category: 'health'   },
  'coverage-trend':   { action: 'Add tests in next deep-work session',                    category: 'health'   },
  'file-metric':      { action: 'Split large file in deep-work session',                  category: 'fitness'  },
  'forbidden-pattern':{ action: 'Remove forbidden pattern',                               category: 'fitness'  },
  'structure':        { action: 'Add colocated test file',                                category: 'fitness'  },
  'dependency':       { action: 'Fix dependency constraint',                              category: 'fitness'  },
  'docs-stale':       { action: 'Run /deep-docs-scan',                                   category: 'docs'     },
  'evolve-low-keep':    { action: 'Run /deep-evolve with meta analysis',           category: 'evolve' },
  'evolve-high-crash':  { action: 'Check eval harness before /deep-evolve',        category: 'evolve' },
  'evolve-stale':       { action: 'Run /deep-evolve for improvement',              category: 'evolve' },
  'evolve-low-q':       { action: 'Review strategy.yaml — Q(v) declining',         category: 'evolve' },
  'evolve-no-transfer': { action: 'Build meta-archive with more /deep-evolve',     category: 'evolve' },
};

// ---------------------------------------------------------------------------
// Finding extractors
// ---------------------------------------------------------------------------

/**
 * Extract findings from deep-review fitness data.
 *
 * Expects fitness.rules to be an array of rule result objects such as:
 *   { rule_id, type, passed, severity, detail }
 */
function extractFitnessFindings(data) {
  const fitness = data.deepReview?.fitness;
  if (!fitness) return [];

  const rules = fitness.rules ?? fitness.results ?? [];
  if (!Array.isArray(rules)) return [];

  return rules
    .filter((r) => r.passed === false)
    .map((r) => ({
      finding: r.rule_id ?? r.type ?? 'unknown',
      severity: r.severity ?? 'warning',
      detail: r.detail ?? r.message ?? null,
    }));
}

/**
 * Extract findings from deep-review receipts.
 *
 * Receipts may contain a `findings` array of objects with { type, severity, detail }.
 */
function extractReceiptFindings(data) {
  const receipts = data.deepReview?.receipts ?? [];
  const findings = [];

  for (const receipt of receipts) {
    const receiptFindings = receipt.findings ?? [];
    for (const f of receiptFindings) {
      findings.push({
        finding: f.type ?? f.rule_id ?? 'unknown',
        severity: f.severity ?? 'warning',
        detail: f.detail ?? f.message ?? null,
      });
    }
  }

  return findings;
}

/**
 * Extract docs staleness findings from deep-docs last-scan.
 */
function extractDocsFindings(data) {
  const scanData = data.deepDocs?.data;
  if (!scanData) return [];

  const stale = scanData.stale_docs ?? [];
  if (!Array.isArray(stale) || stale.length === 0) return [];

  return [{
    finding: 'docs-stale',
    severity: 'warning',
    detail: `${stale.length} stale doc(s): ${stale.slice(0, 3).join(', ')}${stale.length > 3 ? '...' : ''}`,
  }];
}

/**
 * Extract findings from deep-evolve receipt.
 *
 * Detects: low keep rate, high crash rate, declining Q trajectory, staleness,
 * and absence of meta-archive transfer.
 */
function extractEvolveFindings(data) {
  const receipt = data.deepEvolve?.receipt;
  if (!receipt) return [];

  const findings = [];
  const experiments = receipt.experiments;
  if (!experiments) return findings;

  if (experiments.keep_rate !== undefined && experiments.keep_rate < 0.15) {
    findings.push({
      finding: 'evolve-low-keep',
      severity: 'warning',
      detail: `keep rate ${(experiments.keep_rate * 100).toFixed(0)}% — meta analysis로 전략 개선 권장`,
    });
  }

  if (experiments.total > 0 && experiments.crashed / experiments.total > 0.2) {
    findings.push({
      finding: 'evolve-high-crash',
      severity: 'error',
      detail: `crash rate ${((experiments.crashed / experiments.total) * 100).toFixed(0)}% — eval harness 안정성 점검 필요`,
    });
  }

  const qt = receipt.strategy_evolution?.q_trajectory;
  if (qt && qt.length >= 3) {
    const last3 = qt.slice(-3);
    if (last3[0] - last3[2] > 0.05) {
      findings.push({
        finding: 'evolve-low-q',
        severity: 'warning',
        detail: `Q(v) trajectory declining: ${last3.map((q) => q.toFixed(2)).join(' → ')}`,
      });
    }
  }

  if (receipt.timestamp) {
    const daysSince = (Date.now() - new Date(receipt.timestamp).getTime()) / 86400000;
    if (daysSince > 30) {
      findings.push({
        finding: 'evolve-stale',
        severity: 'info',
        detail: `마지막 실험이 ${Math.floor(daysSince)}일 전 — 추가 개선 가능`,
      });
    }
  }

  if (!receipt.transfer?.received_from && !receipt.meta_archive_updated) {
    findings.push({
      finding: 'evolve-no-transfer',
      severity: 'info',
      detail: '이 세션에서 전이 학습 미활용 — /deep-evolve를 더 많은 프로젝트에서 실행하여 meta-archive 구축',
    });
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Map all findings in the collected data to suggested actions.
 *
 * @param {object} data — result from collectData()
 * @returns {Array<{ finding: string, severity: string, suggested_action: string, detail: string|null }>}
 */
export function getSuggestedActions(data) {
  const rawFindings = [
    ...extractFitnessFindings(data),
    ...extractReceiptFindings(data),
    ...extractDocsFindings(data),
    ...extractEvolveFindings(data),
  ];

  return rawFindings.map(({ finding, severity, detail }) => {
    const mapped = ACTION_MAP[finding];
    return {
      finding,
      severity,
      suggested_action: mapped?.action ?? `Investigate ${finding}`,
      category: mapped?.category ?? 'unknown',
      detail: detail ?? null,
    };
  });
}
