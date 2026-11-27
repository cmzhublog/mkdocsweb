import test from 'node:test';
import assert from 'node:assert/strict';
import { textDiff } from '../src/git-diff.ts';

test('modifications count added/deleted lines and keep independent old/new line numbers', () => {
  const result=textDiff('a\nold\nc\n','a\nnew\nextra\nc\n');
  assert.equal(result.additions,2);assert.equal(result.deletions,1);
  const rows=result.hunks.flatMap(h=>h.rows);
  assert.deepEqual(rows.map(r=>[r.kind,r.oldLine,r.newLine,r.text]),[
    ['context',1,1,'a'],['deleted',2,undefined,'old'],['added',undefined,2,'new'],['added',undefined,3,'extra'],['context',3,4,'c'],
  ]);
});

test('new/deleted/empty files and final newline changes match Git line semantics', () => {
  assert.equal(textDiff('','a\nb\n').additions,2);
  assert.equal(textDiff('a\nb','').deletions,2);
  assert.equal(textDiff('','').hunks.length,0);
  const newline=textDiff('line','line\n');
  assert.equal(newline.additions,1);assert.equal(newline.deletions,1);
  assert.ok(newline.hunks.flatMap(h=>h.rows).some(r=>r.kind==='note'));
});

test('multiple separated hunks and Chinese text preserve unchanged whitespace', () => {
  const before=Array.from({length:30},(_,i)=>`行 ${i}`).join('\n');
  const result=textDiff(before,before.replace('行 1\n','  修改一\n').replace('行 25\n','修改二\n'));
  assert.equal(result.hunks.length,2);
  assert.equal(result.additions,2);assert.equal(result.deletions,2);
  assert.ok(result.hunks.flatMap(h=>h.rows).some(r=>r.text==='  修改一'));
});

test('large previews are bounded while full calculated statistics remain accurate', () => {
  const result=textDiff('',Array.from({length:2100},(_,i)=>`line ${i}\n`).join(''));
  assert.equal(result.additions,2100);assert.equal(result.hunks.flatMap(h=>h.rows).length,2000);assert.equal(result.truncated,true);
  assert.ok(textDiff('a'.repeat(1000001),'').unavailable);
});
