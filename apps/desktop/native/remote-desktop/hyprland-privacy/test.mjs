import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

test('physical triggers and held edges never reach the remote application or confirm themselves', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-privacy-gate-'));
  const root = path.dirname(fileURLToPath(import.meta.url));
  try {
    const source = path.join(directory, 'test.cpp');
    fs.writeFileSync(
      source,
      `
#include "gate.hpp"
#include <cassert>
int main() {
  PrivacyGate gate;
  assert(!gate.consume(true, 28, true, true));
  gate.phase=PrivacyGate::Active;
  assert(!gate.consume(false, 28, true, true)); // remote Enter is ordinary input
  assert(gate.phase==PrivacyGate::Active);
  assert(!gate.consume(true, 42, false, false)); // release held before activation
  assert(gate.consume(true, 28, true, true));
  assert(gate.phase==PrivacyGate::Pending && gate.held.contains(28));
  assert(gate.consume(false, 28, true, true));
  assert(!gate.consume(false, 30, false, false)); // drain old helper before dialog
  gate.phase=PrivacyGate::Confirming;
  assert(gate.consume(true, 28, true, true)); // repeated initiating Enter
  assert(gate.held.contains(28));
  assert(gate.consume(true, 28, false, false));
  assert(!gate.held.contains(28));
  assert(gate.consume(false, 28, true, true)); // injected Enter cannot confirm
  assert(gate.consume(false, 30, false, false)); // full fence while confirming
  gate.phase=PrivacyGate::Resume;
  assert(gate.consume(true, 1, true, true));
  gate.phase=PrivacyGate::Active;
  assert(gate.consume(true, 1, false, false)); // dialog release cannot leak
  assert(gate.phase==PrivacyGate::Active);
  gate.phase=PrivacyGate::Disconnect;
  assert(gate.consume(false, 30, true, true));
  gate.stop();
  assert(gate.held.empty() && !gate.consume(true, 30, true, true));
}
`,
    );
    for (const [command, args] of [
      [
        'c++',
        [
          '-std=c++20',
          '-fsanitize=address,undefined',
          '-g',
          '-I',
          root,
          source,
          '-o',
          path.join(directory, 'test'),
        ],
      ],
      [path.join(directory, 'test'), []],
    ]) {
      const result = spawnSync(command, args, { encoding: 'utf8', timeout: 60000 });
      assert.equal(result.status, 0, result.stderr || String(result.error));
    }
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
