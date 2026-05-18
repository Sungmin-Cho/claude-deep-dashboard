import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

test('Codex skills use directory/SKILL.md layout', () => {
  const manifest = JSON.parse(readFileSync('.codex-plugin/plugin.json', 'utf8'));
  const skillRoot = manifest.skills.replace(/^\.\//, '').replace(/\/$/, '');
  const entries = readdirSync(skillRoot, { withFileTypes: true });

  const directMarkdownFiles = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith('.md'))
    .map((entry) => entry.name);
  assert.deepEqual(
    directMarkdownFiles,
    [],
    'Codex skill roots must contain skill directories, not direct markdown files'
  );

  const skillDirs = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  assert.ok(skillDirs.length > 0, 'expected at least one Codex skill directory');

  for (const skillDir of skillDirs) {
    assert.ok(
      existsSync(join(skillRoot, skillDir, 'SKILL.md')),
      `missing ${join(skillRoot, skillDir, 'SKILL.md')}`
    );
  }
});
