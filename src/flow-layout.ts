import type { ElkNode, ElkExtendedEdge, ElkPort } from 'elkjs';

export interface FlowNode { id: string; type: string; text: string }
export interface FlowEdge { source: string; target: string; label: string; direction?: string }
export interface FlowGraph { nodes: FlowNode[]; edges: FlowEdge[] }
export const FLOW_NODE_WIDTH = 180;
export const FLOW_NODE_HEIGHT = 84;

/** Fixed text area: CJK and long unbroken URLs cannot expand a node. */
export function flowLabel(text: string, columns = 12): string[] {
  const chars = Array.from(text.trim().replace(/\s+/g, ' '));
  const width = (c: string) => /^[\x20-\x7e]$/.test(c) ? .55 : 1;
  const lines: string[] = [];
  let offset = 0;
  for (let row = 0; row < 2 && offset < chars.length; row++) {
    const line: string[] = []; let used = 0;
    while (offset < chars.length && used + width(chars[offset]) <= columns) {
      const c = chars[offset++]; line.push(c); used += width(c);
    }
    if (row === 1 && offset < chars.length) {
      while (line.length && used + 1 > columns) used -= width(line.pop()!);
      line.push('…');
    }
    lines.push(line.join('').trim());
  }
  return lines.length ? lines : ['未命名节点'];
}

export function flowLayoutGraph(graph: FlowGraph): ElkNode {
  const direction = graph.edges.find(e => e.direction)?.direction ?? 'bottom';
  const horizontal = direction === 'right' || direction === 'left';
  const ports = new Map<string, ElkPort[]>();
  for (const node of graph.nodes) ports.set(node.id, []);
  const sides: Record<string, string> = { right: 'EAST', left: 'WEST', top: 'NORTH', bottom: 'SOUTH' };
  const mainSide = sides[direction] ?? 'SOUTH';
  const opposite: Record<string,string> = { EAST:'WEST', WEST:'EAST', NORTH:'SOUTH', SOUTH:'NORTH' };
  const port = (id: string, side: string): ElkPort => ({ id, width:0, height:0, x:side === 'EAST' ? FLOW_NODE_WIDTH : side === 'WEST' ? 0 : FLOW_NODE_WIDTH/2, y:side === 'SOUTH' ? FLOW_NODE_HEIGHT : side === 'NORTH' ? 0 : FLOW_NODE_HEIGHT/2, layoutOptions:{'elk.port.side':side} });
  const edges: ElkExtendedEdge[] = graph.edges.map((edge, i) => {
    const sourcePort = `port-s-${i}`, targetPort = `port-t-${i}`;
    const branch = edge.label === '否';
    ports.get(edge.source)!.push(port(sourcePort, sides[edge.direction ?? ''] ?? (branch ? (horizontal ? 'SOUTH' : 'EAST') : mainSide)));
    ports.get(edge.target)!.push(port(targetPort, opposite[mainSide]));
    return { id:`edge-${i}`, sources:[sourcePort], targets:[targetPort], labels: edge.label ? [{ id:`label-${i}`, text:edge.label, width:30, height:20 }] : [] };
  });
  return {
    id:'flow-root',
    layoutOptions: {
      'elk.algorithm':'layered', 'elk.direction':({right:'RIGHT',left:'LEFT',top:'UP',bottom:'DOWN'} as Record<string,string>)[direction] ?? 'DOWN',
      'elk.edgeRouting':'ORTHOGONAL', 'elk.padding':'[top=28,left=28,bottom=28,right=28]',
      'elk.spacing.nodeNode':'64', 'elk.spacing.edgeNode':'28', 'elk.spacing.edgeEdge':'18',
      'elk.layered.spacing.nodeNodeBetweenLayers':'90', 'elk.layered.spacing.edgeNodeBetweenLayers':'28',
      'elk.layered.spacing.edgeEdgeBetweenLayers':'18', 'elk.layered.crossingMinimization.strategy':'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy':'NETWORK_SIMPLEX', 'elk.layered.mergeEdges':'false',
    },
    children:graph.nodes.map(node => ({ id:node.id, width:FLOW_NODE_WIDTH, height:FLOW_NODE_HEIGHT, ports:ports.get(node.id), layoutOptions:{'elk.portConstraints':'FIXED_POS'} })),
    edges,
  };
}
