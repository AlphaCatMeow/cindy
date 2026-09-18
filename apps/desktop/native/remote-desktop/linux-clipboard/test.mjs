import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
test('clipboard parser bounds formats and binary data without a compositor', () => {
  const source = path.dirname(fileURLToPath(import.meta.url));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cindy-clipboard-test-'));
  const run = (cmd, args) => {
    const result = spawnSync(cmd, args, { encoding: 'utf8', timeout: 60000 });
    assert.equal(result.status, 0, result.stderr || String(result.error));
    return result.stdout.trim();
  };
  try {
    run(process.execPath, [path.join(source, 'build.mjs'), dir]);
    const target = path.join(dir, 'test.c');
    fs.writeFileSync(
      target,
      `
#define main clipboard_main
#include ${JSON.stringify(path.join(source, 'main.c'))}
#undef main
#include <assert.h>
int main(void) {
  unsigned char *bytes=NULL;size_t length=0;
  assert(!decode("YQ==",4,&bytes,&length) && length==1 && bytes[0]=='a');free(bytes);
  assert(decode("Y!==",4,&bytes,&length)==-1);
  assert(decode("A",1,&bytes,&length)==-1);
  assert(decode("====",4,&bytes,&length)==-1);
  assert(payload("{\\\"text\\\":3}")==-1);
  assert(payload("{}")==-1);
  assert(!payload("{\\\"text\\\":\\\"test\\\",\\\"html\\\":\\\"<b>test</b>\\\",\\\"png\\\":\\\"YQ==\\\"}"));
  assert(items[0].length==4 && items[1].length==11 && items[3].length==1);
  for(unsigned i=0;i<4;i++) free(items[i].bytes);
  return 0;
}
`,
    );
    const flags = run('pkg-config', ['--cflags', '--libs', 'wayland-client', 'json-c']).split(
      /\s+/,
    );
    run('cc', [
      '-std=c11',
      '-Wall',
      '-Wextra',
      '-Werror',
      '-fsanitize=address,undefined',
      target,
      path.join(dir, 'wlr-data-control-unstable-v1.c'),
      '-I',
      dir,
      ...flags,
      '-o',
      path.join(dir, 'test'),
    ]);
    run(path.join(dir, 'test'), []);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
