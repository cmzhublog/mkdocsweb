import test from 'node:test';
import assert from 'node:assert/strict';
import { Schema } from 'prosemirror-model';
import { EditorState } from 'prosemirror-state';
import { history, undo } from 'prosemirror-history';
import { lineAtBoundary } from '../src/click-to-write.ts';

const schema = new Schema({nodes:{
  doc:{content:'block+'},paragraph:{content:'text*',group:'block'},
  codeBlock:{content:'text*',group:'block',code:true},text:{},
}});
function state(nodes: ReturnType<typeof schema.node>[]) {
  return EditorState.create({schema,doc:schema.node('doc',null,nodes),plugins:[history()]});
}
const code=()=>schema.node('codeBlock',null,schema.text('st=>start: 开始\nst->e'));
const line=(text='')=>schema.node('paragraph',null,text ? schema.text(text) : undefined);

test('clicking before/after a lone code block inserts a paragraph and selects its start', () => {
  for (const side of ['before','after']) {
    const initial=state([code()]);
    const next=initial.apply(lineAtBoundary(initial,side==='before' ? 0 : initial.doc.content.size)!);
    assert.equal(next.doc.childCount,2);
    assert.equal(next.doc.child(side==='before' ? 0 : 1).type.name,'paragraph');
    assert.equal(next.selection.$from.parentOffset,0);
    assert.equal(next.selection.$from.parent.type.name,'paragraph');
    assert.equal(next.doc.child(side==='before' ? 1 : 0).textContent,initial.doc.firstChild!.textContent);
    assert.ok(undo(next,tr=>assert.ok(next.apply(tr).doc.eq(initial.doc))));
  }
});

test('existing empty paragraphs are reused, repeated clicks do not pile up blank lines', () => {
  let current=state([line(),code(),line()]);
  for (let i=0;i<5;i++) {
    current=current.apply(lineAtBoundary(current,2)!);
    assert.equal(current.doc.childCount,3);
    assert.equal(current.selection.from,1);
    current=current.apply(lineAtBoundary(current,current.doc.content.size-2)!);
    assert.equal(current.doc.childCount,3);
    assert.equal(current.selection.$from.parentOffset,0);
  }
});

test('nonempty text is preserved when inserting between blocks; invalid boundaries are rejected', () => {
  const initial=state([line('已有文字'),code()]);
  const next=initial.apply(lineAtBoundary(initial,initial.doc.firstChild!.nodeSize)!);
  assert.equal(next.doc.firstChild!.textContent,'已有文字');
  assert.equal(next.doc.childCount,3);
  assert.equal(next.doc.child(1).type.name,'paragraph');
  assert.equal(lineAtBoundary(initial,-1),null);
  assert.equal(lineAtBoundary(initial,initial.doc.content.size+1),null);
});
