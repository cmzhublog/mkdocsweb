import test from 'node:test';
import assert from 'node:assert/strict';
import { checkFlowSource, isFlowLanguage } from '../src/flow-source.ts';

test('accepts existing flow syntax, branching, loops, directions and multiline labels', () => {
  const source = `st=>start: 开始框
op=>operation: 开发人员master分支开发
cond=>condition: 是否向release分支合并代码
sub1=>subroutine: 镜像打包 registry.example.com/app:release_latest
io=>inputoutput: 继续开发
e=>end: 结束框

feat01

st(right)->op(right)->cond
cond(no)->io->op
cond(yes)->sub1(right)->e`;
  assert.doesNotThrow(() => checkFlowSource(source));
  for (const name of ['flow', 'flowchart', 'Flow']) assert.equal(isFlowLanguage(name), true);
  assert.equal(isFlowLanguage('mermaid'), false);
  assert.equal(isFlowLanguage('python'), false);
});

test('reports empty, malformed, dangling and excessively large diagrams', () => {
  assert.throws(() => checkFlowSource(''), /请输入/);
  assert.throws(() => checkFlowSource('hello'), /节点定义/);
  assert.throws(() => checkFlowSource('st=>start: 开始\nst->missing'), /未定义节点：missing/);
  assert.throws(() => checkFlowSource('a'.repeat(30001)), /过大/);
});
