import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCLI, formatMarkdown } from './formatter.js';

// ---------------------------------------------------------------------------
// Sample data shared across tests
// ---------------------------------------------------------------------------

const sampleData = {
  topology: 'nextjs-app',
  harnessability: { total: 7.4, grade: 'Good' },
  effectiveness: 7.1,
  health: [
    { type: 'dead-export', status: 'clean', summary: undefined },
    { type: 'dependency-vuln', status: 'critical', summary: '2 critical (npm audit)' },
  ],
  fitness: [
    { ruleId: 'no-large-files', passed: true, violations: [] },
    { ruleId: 'colocated-tests', passed: false, violations: ['src/foo.js', 'src/bar.js'] },
  ],
  sessions: [
    { id: 12, date: '2026-04-09', quality: 8.2, sensors: 'clean', mutation: '94%' },
  ],
  actions: [
    { finding: 'dependency-vuln', suggested_action: 'npm audit fix (2 critical vulnerabilities)', severity: 'critical' },
  ],
  evolve: {
    status: 'available',
    receipt: {
      experiments: { total: 80, kept: 20, discarded: 55, crashed: 5, keep_rate: 0.25 },
      score: { improvement_pct: 4.6 },
      strategy_evolution: { outer_loop_generations: 4, q_trajectory: [0.35, 0.42, 0.48, 0.51] },
      archives: { strategy_archive_size: 4, code_archive_size: 8, code_forks_used: 2 },
      transfer: { received_from: 'archive_001', adopted_patterns_kept: 0.7 },
      quality_score: 78,
      outcome: 'merged',
    },
  },
};

// ---------------------------------------------------------------------------
// Test 1: formatCLI produces non-empty output with expected content
// ---------------------------------------------------------------------------

test('formatCLI produces non-empty output with expected content', () => {
  const output = formatCLI(sampleData);

  assert.ok(typeof output === 'string', 'output should be a string');
  assert.ok(output.length > 0, 'output should be non-empty');

  // Box borders
  assert.ok(output.includes('╔'), 'should contain top-left box corner');
  assert.ok(output.includes('╚'), 'should contain bottom-left box corner');

  // Header
  assert.ok(output.includes('Deep-Suite Harness Dashboard'), 'should include dashboard title');

  // Topology and harnessability
  assert.ok(output.includes('nextjs-app'), 'should include topology');
  assert.ok(output.includes('7.4/10'), 'should include harnessability score');
  assert.ok(output.includes('Good'), 'should include harnessability grade');

  // Health section
  assert.ok(output.includes('Health Status'), 'should include Health Status section');
  assert.ok(output.includes('dead-export'), 'should include dead-export sensor');
  assert.ok(output.includes('dependency-vuln'), 'should include dependency-vuln sensor');

  // Fitness section
  assert.ok(output.includes('Fitness Rules'), 'should include Fitness Rules section');
  assert.ok(output.includes('no-large-files'), 'should include no-large-files rule');
  assert.ok(output.includes('colocated-tests'), 'should include colocated-tests rule');

  // Sessions section
  assert.ok(output.includes('Recent Sessions'), 'should include Recent Sessions section');
  assert.ok(output.includes('#12'), 'should include session id');

  // Effectiveness
  assert.ok(output.includes('7.1/10'), 'should include effectiveness score');
});

// ---------------------------------------------------------------------------
// Test 2: formatCLI includes suggested actions
// ---------------------------------------------------------------------------

test('formatCLI includes suggested actions', () => {
  const output = formatCLI(sampleData);

  assert.ok(output.includes('Suggested actions'), 'should include Suggested actions header');
  assert.ok(output.includes('npm audit fix'), 'should include the suggested action text');
});

// ---------------------------------------------------------------------------
// Test 3: formatMarkdown produces valid markdown starting with correct header
// ---------------------------------------------------------------------------

test('formatMarkdown produces valid markdown starting with "# Deep-Suite Harness Dashboard"', () => {
  const output = formatMarkdown(sampleData);

  assert.ok(typeof output === 'string', 'output should be a string');
  assert.ok(output.length > 0, 'output should be non-empty');
  assert.ok(
    output.trimStart().startsWith('# Deep-Suite Harness Dashboard'),
    'should start with the correct H1 heading'
  );

  // Should contain markdown table syntax
  assert.ok(output.includes('| Sensor |'), 'should include Health Status table header');

  // Should contain topology and harnessability
  assert.ok(output.includes('nextjs-app'), 'should include topology');
  assert.ok(output.includes('7.4/10'), 'should include harnessability score');

  // Should contain effectiveness
  assert.ok(output.includes('## Overall Effectiveness'), 'should include effectiveness heading');
  assert.ok(output.includes('7.1/10'), 'should include effectiveness score');

  // Should contain suggested actions
  assert.ok(output.includes('## Suggested Actions'), 'should include Suggested Actions heading');
  assert.ok(output.includes('npm audit fix'), 'should include action text');

  // Should contain generated date footer
  assert.ok(output.includes('*Generated:'), 'should include generated date');
});

// ---------------------------------------------------------------------------
// Test 4-8: Evolve section
// ---------------------------------------------------------------------------

test('formatCLI includes Evolve section when receipt exists', () => {
  const output = formatCLI(sampleData);
  assert.ok(output.includes('Evolve'), 'should include Evolve section');
  assert.ok(output.includes('78/100'), 'should include quality score');
});

test('formatMarkdown includes Evolve section when receipt exists', () => {
  const output = formatMarkdown(sampleData);
  assert.ok(output.includes('## Evolve'), 'should include Evolve heading');
  assert.ok(output.includes('78/100'), 'should include quality score');
  assert.ok(output.includes('4.6%'), 'should include improvement');
});

test('formatCLI omits Evolve section when no receipt', () => {
  const dataWithout = { ...sampleData, evolve: { status: 'no_data', receipt: null } };
  const output = formatCLI(dataWithout);
  assert.ok(!output.includes('Evolve'), 'should not include Evolve section');
});

test('formatMarkdown marks discarded outcome', () => {
  const discardedData = {
    ...sampleData,
    evolve: {
      ...sampleData.evolve,
      receipt: { ...sampleData.evolve.receipt, outcome: 'discarded' },
    },
  };
  const output = formatMarkdown(discardedData);
  assert.ok(output.includes('discarded'), 'should show discarded in markdown');
});

test('formatCLI marks discarded outcome', () => {
  const discardedData = {
    ...sampleData,
    evolve: {
      ...sampleData.evolve,
      receipt: { ...sampleData.evolve.receipt, outcome: 'discarded' },
    },
  };
  const output = formatCLI(discardedData);
  assert.ok(output.includes('discarded'), 'should show discarded status');
});

// ---------------------------------------------------------------------------
// Test: renderHealth does not throw when health entry lacks type
// ---------------------------------------------------------------------------

test('renderHealth does not throw when health entry lacks `type`', () => {
  const partialData = {
    topology: 'nextjs-app',
    harnessability: { total: 7.4, grade: 'Good' },
    effectiveness: 7.1,
    health: [
      { status: 'clean' }, // type intentionally omitted
    ],
    fitness: [],
    sessions: [],
    actions: [],
  };

  // Should not throw
  const cli = formatCLI(partialData);
  assert.ok(typeof cli === 'string' && cli.length > 0);

  const md = formatMarkdown(partialData);
  assert.ok(typeof md === 'string' && md.length > 0);
});

// ---------------------------------------------------------------------------
// Test: renderEvolveCLI emits '?' (not 'NaN') when q_trajectory contains NaN
// ---------------------------------------------------------------------------

test("renderEvolveCLI emits '?' (not 'NaN') when q_trajectory contains NaN", () => {
  const nanData = {
    topology: 'nextjs-app',
    harnessability: { total: 7.4, grade: 'Good' },
    effectiveness: 7.1,
    health: [],
    fitness: [],
    sessions: [],
    actions: [],
    evolve: {
      status: 'available',
      receipt: {
        experiments: { total: 10, kept: 2, discarded: 7, crashed: 1, keep_rate: 0.20 },
        score: { improvement_pct: 1.0 },
        strategy_evolution: { outer_loop_generations: 1, q_trajectory: [NaN, 0.42, NaN] },
        archives: { strategy_archive_size: 0, code_archive_size: 0, code_forks_used: 0 },
        transfer: null,
        quality_score: 50,
        outcome: 'merged',
      },
    },
  };

  const cli = formatCLI(nanData);
  const md = formatMarkdown(nanData);

  assert.ok(!cli.includes('NaN'), `CLI output should not contain 'NaN', got: ${cli}`);
  assert.ok(!md.includes('NaN'), `Markdown output should not contain 'NaN', got: ${md}`);
  assert.ok(cli.includes('?'), 'CLI output should substitute ? for NaN values');
});

// ---------------------------------------------------------------------------
// Test: formatMarkdown escapes literal `|` across all table cells
// ---------------------------------------------------------------------------

test('formatMarkdown escapes literal `|` in finding strings, session sensors, and transfer.received_from', () => {
  const pipeData = {
    topology: 'mixed',
    harnessability: { total: 7.0, grade: 'Good' },
    effectiveness: 7.0,
    health: [
      { type: 'has|pipe', status: 'clean', summary: 'fine|here' },
    ],
    fitness: [
      { ruleId: 'rule|A', passed: false, violations: ['x'] },
    ],
    sessions: [
      { id: 1, date: '2026-04-17', quality: 8.0, sensors: 'clean|x', mutation: '90%|y' },
    ],
    actions: [],
    evolve: {
      status: 'available',
      receipt: {
        experiments: { total: 10, kept: 2, discarded: 7, crashed: 1, keep_rate: 0.20 },
        score: { improvement_pct: 1.0 },
        strategy_evolution: { outer_loop_generations: 1, q_trajectory: [0.5] },
        archives: { strategy_archive_size: 0, code_archive_size: 0, code_forks_used: 0 },
        transfer: { received_from: 'arch|01', adopted_patterns_kept: 0.5 },
        quality_score: 50,
        outcome: 'merged',
      },
    },
  };

  const md = formatMarkdown(pipeData);

  // Assertion 1 (value-level): every raw pipe value must appear in escaped form,
  // and must NOT appear in unescaped form sandwiched between spaces (cell context).
  for (const raw of ['has|pipe', 'fine|here', 'rule|A', 'clean|x', '90%|y', 'arch|01']) {
    assert.ok(
      md.includes(raw.replace(/\|/g, '\\|')),
      `expected escaped "${raw.replace(/\|/g, '\\|')}" in Markdown output`
    );
    assert.ok(
      !md.includes(` ${raw} `),
      `unescaped "${raw}" must not appear inside a Markdown cell`
    );
  }

  // Assertion 2 (structural): every pipe-table data row must split into the
  // expected number of columns when splitting on UNESCAPED `|`. If any cell
  // value smuggled an unescaped pipe, that row would split into more columns.
  // We walk rows that START with `|` and are NOT separators (contain non-dash).
  const dataRows = md.split('\n').filter(
    (line) => line.startsWith('|') && /[^|\-\s:]/.test(line)
  );
  for (const row of dataRows) {
    // Replace ESCAPED pipes with a sentinel, then split on remaining pipes.
    const cols = row.replace(/\\\|/g, '\x00').split('|');
    // Pipe-table rows start and end with `|`, so the first and last elements
    // are empty strings. The middle elements are the cells.
    const cellCount = cols.length - 2;
    assert.ok(cellCount >= 2, `row produced unexpected column count: ${row}`);
  }
});
