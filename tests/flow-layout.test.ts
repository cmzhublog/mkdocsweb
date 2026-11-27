import test from 'node:test';
import assert from 'node:assert/strict';
import ELK from 'elkjs/lib/elk.bundled.js';
import { flowLabel, flowLayoutGraph, FLOW_NODE_HEIGHT, FLOW_NODE_WIDTH, type FlowGraph } from '../src/flow-layout.ts';

const graph: FlowGraph = {
  nodes:['st','op','cond','sub','io','e'].map(id => ({id,type:id === 'cond' ? 'condition' : 'operation',text:id})),
  edges:[
    {source:'st',target:'op',label:'',direction:'right'}, {source:'op',target:'cond',label:'',direction:'right'},
    {source:'cond',target:'io',label:'否'}, {source:'io',target:'op',label:''},
    {source:'cond',target:'sub',label:'是'}, {source:'sub',target:'e',label:'',direction:'right'},
  ],
};

test('uniform node dimensions and orthogonal routes avoid unrelated node bodies, including loops', async () => {
  const layout = await new ELK().layout(flowLayoutGraph(graph));
  for (const node of layout.children!) {
    assert.equal(node.width,FLOW_NODE_WIDTH); assert.equal(node.height,FLOW_NODE_HEIGHT);
  }
  for (const [index,edge] of layout.edges!.entries()) {
    assert.ok(edge.sections?.length);
    for (const section of edge.sections!) {
      const points=[section.startPoint,...(section.bendPoints ?? []),section.endPoint];
      for (let i=1;i<points.length;i++) {
        const a=points[i-1],b=points[i];
        assert.ok(a.x===b.x || a.y===b.y,'route is orthogonal');
        for (const node of layout.children!) {
          if ([graph.edges[index].source,graph.edges[index].target].includes(node.id)) continue;
          const left=node.x!,right=left+node.width!,top=node.y!,bottom=top+node.height!;
          const crosses=a.y===b.y ? a.y>top && a.y<bottom && Math.max(a.x,b.x)>left && Math.min(a.x,b.x)<right : a.x>left && a.x<right && Math.max(a.y,b.y)>top && Math.min(a.y,b.y)<bottom;
          assert.equal(crosses,false,`edge ${edge.id} must avoid ${node.id}`);
        }
      }
    }
  }
});

test('long Chinese, URLs and emoji labels fit two lines without changing full text', () => {
  for (const text of ['镜像打包基础 registry.example.com/very/long/path:release_latest','这是一个非常非常长的判断条件需要鼠标悬停显示全部文字','😀'.repeat(50)]) {
    const lines=flowLabel(text);
    assert.ok(lines.length<=2); assert.ok(lines.at(-1)!.endsWith('…'));
    for (const line of lines) assert.ok([...line].reduce((sum,c)=>sum+(/^[\x20-\x7e]$/.test(c)?.55:1),0)<=12.001);
  }
  assert.deepEqual(flowLabel('开始'),['开始']);
});
