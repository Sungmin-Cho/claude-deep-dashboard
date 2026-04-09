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
