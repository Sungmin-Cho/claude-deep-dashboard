/**
 * Dashboard Formatter — deep-dashboard
 *
 * Two output modes:
 *   formatCLI(data)      — box-drawing ASCII table for terminal display
 *   formatMarkdown(data) — markdown tables for file generation
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BOX_WIDTH = 54; // inner content width (between ║ borders)

// ---------------------------------------------------------------------------
// Box-drawing helpers
// ---------------------------------------------------------------------------

function pad(str, width) {
  // Pad a string to exactly `width` visible characters (left-aligned)
  const visible = stripAnsi(str);
  const extra = width - visible.length;
  return str + ' '.repeat(Math.max(0, extra));
}

function stripAnsi(str) {
  // Remove ANSI escape codes for width calculation
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1B\[[0-9;]*m/g, '');
}

function boxLine(content) {
  // Wrap content in ║...║ padded to BOX_WIDTH
  return `║ ${pad(content, BOX_WIDTH - 1)}║`;
}

function topBorder() {
  return `╔${'═'.repeat(BOX_WIDTH + 1)}╗`;
}

function divider() {
  return `╠${'═'.repeat(BOX_WIDTH + 1)}╣`;
}

function bottomBorder() {
  return `╚${'═'.repeat(BOX_WIDTH + 1)}╝`;
}

function centerLine(text) {
  const totalPad = BOX_WIDTH - text.length;
  const leftPad = Math.floor(totalPad / 2);
  const rightPad = totalPad - leftPad;
  return `║${' '.repeat(leftPad)}${text}${' '.repeat(rightPad)} ║`;
}

// ---------------------------------------------------------------------------
// Section renderers
// ---------------------------------------------------------------------------

function renderHealth(health) {
  const lines = [];
  const last = health.length > 0
    ? (health.find(h => h.date) || {}).date || new Date().toISOString().slice(0, 10)
    : new Date().toISOString().slice(0, 10);

  lines.push(boxLine(`◆ Health Status (last: ${last})`));
  for (const h of health) {
    const icon = (h.status === 'clean' || h.status === 'pass') ? '✓' : '✗';
    const detail = h.summary ? `${icon} ${h.summary}` : (h.status === 'clean' ? '✓ clean' : `✗ ${h.status}`);
    lines.push(boxLine(`  ${pad(h.type, 18)} ${detail}`));
  }
  return lines;
}

function renderFitness(fitness) {
  const lines = [];
  lines.push(boxLine(`◆ Fitness Rules (${fitness.length} rules)`));
  for (const f of fitness) {
    const icon = f.passed ? '✓ pass' : `✗ ${f.violations?.length ?? 0} violations`;
    lines.push(boxLine(`  ${pad(f.ruleId, 18)} ${icon}`));
  }
  return lines;
}

function renderSessions(sessions) {
  const lines = [];
  const count = Math.min(sessions.length, 3);
  lines.push(boxLine(`◆ Recent Sessions (last ${count})`));
  for (const s of sessions.slice(0, 3)) {
    const sensors = s.sensors ? ` sensors:${s.sensors}` : '';
    const mutation = s.mutation ? ` mut:${s.mutation}` : '';
    lines.push(boxLine(`  #${s.id} ${s.date} quality:${s.quality}${sensors}${mutation}`));
  }
  return lines;
}

function renderActions(actions) {
  const lines = [];
  lines.push(boxLine('Suggested actions:'));
  for (let i = 0; i < actions.length; i++) {
    lines.push(boxLine(` ${i + 1}. ${actions[i].suggested_action}`));
  }
  return lines;
}

function renderEvolveCLI(evolve) {
  if (!evolve?.receipt) return [];

  const r = evolve.receipt;
  const exp = r.experiments ?? {};
  const keepPct = Math.round((exp.keep_rate ?? 0) * 100);
  const crashRate = exp.total > 0 ? ((exp.crashed ?? 0) / exp.total) : 0;
  const crashPct = Math.round(crashRate * 100);
  const improv = r.score?.improvement_pct ?? 0;
  const ev = r.strategy_evolution ?? {};
  const gens = ev.outer_loop_generations ?? 0;
  const qtraj = ev.q_trajectory ?? [];
  const qFirst = qtraj[0]?.toFixed(2) ?? '?';
  const qLast = qtraj[qtraj.length - 1]?.toFixed(2) ?? '?';
  const arch = r.archives ?? {};
  const qualStr = `${r.quality_score ?? 0}/100${r.outcome === 'discarded' ? ' (discarded)' : ''}`;

  const lines = [];
  lines.push(divider());
  lines.push(centerLine('Evolve'));
  lines.push(boxLine(`  Experiments: ${exp.total ?? 0} (keep: ${keepPct}%, crash: ${crashPct}%)`));
  lines.push(boxLine(`  Improvement: +${improv}%`));
  lines.push(boxLine(`  Strategy: ${gens} gen, Q: ${qFirst} → ${qLast}`));
  lines.push(boxLine(`  Archives: ${arch.strategy_archive_size ?? 0} strategies, ${arch.code_archive_size ?? 0} code, ${arch.code_forks_used ?? 0} forks`));
  lines.push(boxLine(`  Quality: ${qualStr}`));
  return lines;
}

function renderEvolveMarkdown(evolve) {
  if (!evolve?.receipt) return [];

  const r = evolve.receipt;
  const exp = r.experiments ?? {};
  const keepPct = Math.round((exp.keep_rate ?? 0) * 100);
  const crashRate = exp.total > 0 ? ((exp.crashed ?? 0) / exp.total) : 0;
  const crashPct = Math.round(crashRate * 100);
  const improv = r.score?.improvement_pct ?? 0;
  const ev = r.strategy_evolution ?? {};
  const gens = ev.outer_loop_generations ?? 0;
  const qtraj = ev.q_trajectory ?? [];
  const qFirst = qtraj[0]?.toFixed(2) ?? '?';
  const qLast = qtraj[qtraj.length - 1]?.toFixed(2) ?? '?';
  const arch = r.archives ?? {};
  const transfer = r.transfer ?? null;
  const qualStr = `${r.quality_score ?? 0}/100${r.outcome === 'discarded' ? ' (discarded)' : ''}`;

  const parts = [];
  parts.push('## Evolve');
  parts.push('');
  parts.push('| Metric | Value |');
  parts.push('|--------|-------|');
  parts.push(`| Experiments | ${exp.total ?? 0} (keep: ${keepPct}%, crash: ${crashPct}%) |`);
  parts.push(`| Improvement | +${improv}% from baseline |`);
  parts.push(`| Strategy Evolution | ${gens} generations, Q: ${qFirst} → ${qLast} |`);
  parts.push(`| Archives | ${arch.strategy_archive_size ?? 0} strategies, ${arch.code_archive_size ?? 0} code snapshots, ${arch.code_forks_used ?? 0} forks |`);
  if (transfer?.received_from) {
    const adoptPct = Math.round((transfer.adopted_patterns_kept ?? 0) * 100);
    parts.push(`| Transfer | From ${transfer.received_from} (adoption: ${adoptPct}%) |`);
  }
  parts.push(`| Quality Score | ${qualStr} |`);
  parts.push('');
  return parts;
}

// ---------------------------------------------------------------------------
// formatCLI
// ---------------------------------------------------------------------------

/**
 * Format dashboard data as a box-drawing CLI table.
 *
 * @param {object} data
 * @param {string} data.topology
 * @param {{ total: number, grade: string }} data.harnessability
 * @param {number|null} data.effectiveness
 * @param {Array<{ type: string, status: string, summary?: string }>} data.health
 * @param {Array<{ ruleId: string, passed: boolean, violations?: [] }>} data.fitness
 * @param {Array<{ id: number, date: string, quality: number }>} data.sessions
 * @param {Array<{ finding: string, suggested_action: string, severity: string }>} data.actions
 * @returns {string}
 */
export function formatCLI(data) {
  const {
    topology = 'unknown',
    harnessability = { total: 0, grade: 'Unknown' },
    effectiveness = null,
    health = [],
    fitness = [],
    sessions = [],
    actions = [],
    evolve = null,
  } = data;

  const lines = [];

  lines.push(topBorder());
  lines.push(centerLine('Deep-Suite Harness Dashboard'));
  lines.push(divider());

  // Topology + harnessability row
  const harnessStr = `${harnessability.total}/10 (${harnessability.grade})`;
  lines.push(boxLine(`Topology: ${topology} │ Harnessability: ${harnessStr}`));

  lines.push(divider());

  // Health section
  if (health.length > 0) {
    lines.push(...renderHealth(health));
  }

  // Fitness section
  if (fitness.length > 0) {
    lines.push(...renderFitness(fitness));
  }

  // Sessions section
  if (sessions.length > 0) {
    lines.push(...renderSessions(sessions));
  }

  // Evolve section
  lines.push(...renderEvolveCLI(evolve));

  lines.push(divider());

  // Effectiveness
  const effectivenessStr = effectiveness !== null ? `${effectiveness}/10` : 'N/A';
  lines.push(boxLine(`Overall Harness Effectiveness: ${effectivenessStr}`));

  // Suggested actions
  if (actions.length > 0) {
    lines.push(...renderActions(actions));
  }

  lines.push(bottomBorder());

  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// formatMarkdown
// ---------------------------------------------------------------------------

/**
 * Format dashboard data as a markdown report.
 *
 * @param {object} data  — same shape as formatCLI
 * @returns {string}
 */
export function formatMarkdown(data) {
  const {
    topology = 'unknown',
    harnessability = { total: 0, grade: 'Unknown' },
    effectiveness = null,
    health = [],
    fitness = [],
    sessions = [],
    actions = [],
    evolve = null,
  } = data;

  const today = new Date().toISOString().slice(0, 10);
  const parts = [];

  // Title
  parts.push('# Deep-Suite Harness Dashboard');
  parts.push('');
  parts.push(`**Topology:** ${topology} | **Harnessability:** ${harnessability.total}/10 (${harnessability.grade})`);
  parts.push('');

  // Health Status
  if (health.length > 0) {
    parts.push('## Health Status');
    parts.push('');
    parts.push('| Sensor | Status | Detail |');
    parts.push('|--------|--------|--------|');
    for (const h of health) {
      const icon = (h.status === 'clean' || h.status === 'pass') ? '✓' : '✗';
      const detail = h.summary || h.status;
      parts.push(`| ${h.type} | ${icon} ${h.status} | ${detail} |`);
    }
    parts.push('');
  }

  // Fitness Rules
  if (fitness.length > 0) {
    parts.push('## Fitness Rules');
    parts.push('');
    parts.push('| Rule | Result | Violations |');
    parts.push('|------|--------|-----------|');
    for (const f of fitness) {
      const result = f.passed ? '✓ pass' : '✗ fail';
      const violations = f.passed ? '-' : (f.violations?.length ?? 0);
      parts.push(`| ${f.ruleId} | ${result} | ${violations} |`);
    }
    parts.push('');
  }

  // Sessions
  if (sessions.length > 0) {
    parts.push('## Recent Sessions');
    parts.push('');
    parts.push('| # | Date | Quality | Sensors | Mutation |');
    parts.push('|---|------|---------|---------|---------|');
    for (const s of sessions.slice(0, 3)) {
      parts.push(`| ${s.id} | ${s.date} | ${s.quality} | ${s.sensors ?? '-'} | ${s.mutation ?? '-'} |`);
    }
    parts.push('');
  }

  // Evolve section
  parts.push(...renderEvolveMarkdown(evolve));

  // Effectiveness
  const effectivenessStr = effectiveness !== null ? `${effectiveness}/10` : 'N/A';
  parts.push(`## Overall Effectiveness: ${effectivenessStr}`);
  parts.push('');

  // Suggested Actions
  if (actions.length > 0) {
    parts.push('## Suggested Actions');
    parts.push('');
    for (const a of actions) {
      parts.push(`- **${a.finding}**: ${a.suggested_action}`);
    }
    parts.push('');
  }

  parts.push(`*Generated: ${today}*`);

  return parts.join('\n');
}
