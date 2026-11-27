import DOMPurify from 'dompurify';
import { checkFlowSource } from './flow-source.ts';

import { flowLabel, fitFlowLayout, type FlowGraph } from './flow-layout.ts';

let library: Promise<typeof import('flowchart.js')> | undefined;
let engine: Promise<import('elkjs').ELK> | undefined;
let svgSequence = 0;
interface ParsedSymbol {
  key: string; symbolType: string; text: string | null;
  next?: ParsedSymbol; yes?: ParsedSymbol; no?: ParsedSymbol; path1?: ParsedSymbol; path2?: ParsedSymbol; path3?: ParsedSymbol;
  direction_next?: string; direction_yes?: string; direction_no?: string; direction_path1?: string; direction_path2?: string; direction_path3?: string;
}
const svgNS = 'http://www.w3.org/2000/svg';
function svgElement(tag: string, attrs: Record<string, string | number> = {}) {
  const node = document.createElementNS(svgNS, tag);
  for (const [name, value] of Object.entries(attrs)) node.setAttribute(name, String(value));
  return node;
}

/** Preserve the flow DSL parser, replace its drawing with obstacle-aware routing. */
export async function flowSVG(source: string, availableWidth = 800): Promise<string> {
  checkFlowSource(source);
  const [flowchart, elk] = await Promise.all([
    library ??= import('flowchart.js').then(module => (module as unknown as { default: typeof import('flowchart.js') }).default).catch(error => { library = undefined; throw error; }),
    engine ??= import('elkjs/lib/elk.bundled.js').then(module => new module.default()).catch(error => { engine = undefined; throw error; }),
  ]);
  const parsed = flowchart.parse(source) as ReturnType<typeof flowchart.parse> & { symbols: Record<string, ParsedSymbol> };
  const symbols = Object.values(parsed.symbols);
  const graph: FlowGraph = { nodes:symbols.map(node => ({ id:node.key, type:node.symbolType, text:node.text || node.key })), edges:[] };
  const labels: Record<string,string> = { yes:'是', no:'否', path1:'分支 1', path2:'分支 2', path3:'分支 3', next:'' };
  for (const node of symbols) {
    for (const path of ['next','yes','no','path1','path2','path3'] as const) {
      if (node[path]) graph.edges.push({ source:node.key, target:node[path]!.key, label:labels[path], direction:node[`direction_${path}`] });
    }
  }
  if (!graph.edges.length) throw new Error('无法识别流程图连线，请检查语法。');
  const layout = await fitFlowLayout(graph,elk,availableWidth);
  const width = layout.width || 1, height = layout.height || 1;
  if (!Number.isFinite(width + height) || width + height > 100000) throw new Error('流程图尺寸无效，请简化内容。');
  const colors = getComputedStyle(document.documentElement);
  const color = (name: string, fallback: string) => colors.getPropertyValue(name).trim() || fallback;
  const ink = color('--ink','#263a30'), accent = color('--green','#34664c'), paper = color('--paper','#fff');
  const svg = svgElement('svg', { xmlns:svgNS, viewBox:`0 0 ${width} ${height}`, width, height, role:'img', 'aria-label':'流程图' });
  svg.setAttribute('style', `display:block;width:100%;max-width:100%;min-width:0;height:auto;margin:auto`);
  const markerId = `flow-arrow-${++svgSequence}`;
  const defs = svgElement('defs');
  const marker = svgElement('marker', { id:markerId, viewBox:'0 0 10 10', refX:9, refY:5, markerWidth:7, markerHeight:7, orient:'auto-start-reverse' });
  marker.append(svgElement('path', { d:'M 0 0 L 10 5 L 0 10 z', fill:accent })); defs.append(marker); svg.append(defs);
  const anchor = (point: {x:number;y:number}, id: string) => {
    const node=layout.children?.find(n => n.id === id);
    const model=graph.nodes.find(n => n.id === id);
    if (!node || !model || !['inputoutput','input','output'].includes(model.type)) return point;
    const y=point.y-node.y!, slope=18*y/node.height!;
    if (Math.abs(point.x-node.x!)<.1) return {x:node.x!+18-slope,y:point.y};
    if (Math.abs(point.x-node.x!-node.width!)<.1) return {x:node.x!+node.width!-slope,y:point.y};
    return point;
  };
  // Draw edges first: even in crowded diagrams they never paint over node faces.
  for (const edge of (layout.edges ?? []).filter(edge => edge.id.startsWith('edge-'))) {
    for (const section of edge.sections ?? []) {
      const model=graph.edges[Number(edge.id.slice(5))];
      const points = [anchor(section.startPoint,model.source), ...(section.bendPoints ?? []), anchor(section.endPoint,model.target)];
      svg.append(svgElement('path', { d:points.map((p,i) => `${i ? 'L' : 'M'} ${p.x} ${p.y}`).join(' '), fill:'none', stroke:accent, 'stroke-width':1.5, 'stroke-linejoin':'round', 'marker-end':`url(#${markerId})` }));
    }
  }
  for (const node of layout.children ?? []) {
    const model = graph.nodes.find(n => n.id === node.id)!;
    const w=node.width!, h=node.height!;
    const group = svgElement('g', { transform:`translate(${node.x},${node.y})`, tabindex:0, role:'img', 'aria-label':model.text, class:'flow-node', 'data-flow-node':model.id });
    const title = svgElement('title'); title.textContent=model.text; group.append(title);
    const attrs = { fill:paper, stroke:accent, 'stroke-width':1.5 };
    if (model.type === 'condition') group.append(svgElement('path', { d:`M ${w/2} 0 L ${w} ${h/2} L ${w/2} ${h} L 0 ${h/2} Z`, ...attrs }));
    else if (['inputoutput','input','output'].includes(model.type)) group.append(svgElement('path', { d:`M 18 0 H ${w} L ${w-18} ${h} H 0 Z`, ...attrs }));
    else {
      group.append(svgElement('rect', { x:0, y:0, width:w, height:h, rx:['start','end'].includes(model.type) ? h/2 : 5, ...attrs }));
      if (model.type === 'subroutine') for (const x of [8,w-8]) group.append(svgElement('path', { d:`M ${x} 0 V ${h}`, stroke:accent, 'stroke-width':1.5 }));
      if (model.type === 'parallel') group.append(svgElement('path', { d:`M 0 8 H ${w} M 0 ${h-8} H ${w}`, stroke:accent, 'stroke-width':1.5 }));
    }
    const lines=flowLabel(model.text, Math.max(4,Math.floor((model.type === 'condition' ? 7 : 12)*w/180)));
    const text=svgElement('text', { x:w/2, y:h/2-(lines.length-1)*9+4, 'text-anchor':'middle', fill:ink, 'font-size':13, 'font-family':'system-ui, sans-serif', 'pointer-events':'none' });
    lines.forEach((line,i) => { const span=svgElement('tspan',{x:w/2, dy:i ? 18 : 0}); span.textContent=line; text.append(span); });
    group.append(text); svg.append(group);
  }
  for (const edge of (layout.edges ?? []).filter(edge => edge.id.startsWith('edge-'))) for (const label of edge.labels ?? []) {
    svg.append(svgElement('rect', { x:(label.x ?? 0)-3, y:(label.y ?? 0)-2, width:(label.width ?? 30)+6, height:(label.height ?? 20)+4, rx:3, fill:paper }));
    const text=svgElement('text', { x:label.x ?? 0, y:(label.y ?? 0)+14, fill:ink, 'font-size':12, 'font-family':'system-ui, sans-serif' }); text.textContent=label.text ?? ''; svg.append(text);
  }
  return DOMPurify.sanitize(svg.outerHTML, { USE_PROFILES:{svg:true,svgFilters:true}, ADD_ATTR:['tabindex','role','aria-label'], FORBID_TAGS:['a','image','foreignObject','script','animate','set'], FORBID_ATTR:['href','xlink:href','onclick','onload'] });
}

/** Diagram controls stay outside ProseMirror's contentDOM. Source remains canonical. */
export function flowPreview(shell: HTMLElement, read: () => string, editable: boolean, initiallyEditing = false) {
  const canvas = document.createElement('div');
  canvas.className = 'flow-canvas'; canvas.contentEditable = 'false';
  canvas.tabIndex = 0;
  canvas.setAttribute('role', 'region'); canvas.setAttribute('aria-label', '流程图预览');
  const toggle = document.createElement('button');
  toggle.type = 'button'; toggle.className = 'flow-source-toggle'; toggle.contentEditable = 'false';
  toggle.textContent = initiallyEditing ? '预览流程图' : '编辑源码'; toggle.setAttribute('aria-pressed', String(initiallyEditing));
  let editing = initiallyEditing, disposed = false, generation = 0, key = '';
  let timer: ReturnType<typeof setTimeout> | undefined;
  async function render() {
    const source = read();
    const style=getComputedStyle(canvas);
    const availableWidth=Math.max(160,Math.floor(canvas.clientWidth-parseFloat(style.paddingLeft)-parseFloat(style.paddingRight))) || 800;
    const nextKey = `${document.documentElement.dataset.theme}:${availableWidth}:${source}`;
    if (nextKey === key || disposed) return;
    key = nextKey; const current = ++generation;
    canvas.textContent = '正在生成流程图…';
    try {
      const svg = await flowSVG(source,availableWidth);
      if (!disposed && current === generation) { canvas.innerHTML = svg; canvas.classList.remove('flow-error'); }
    } catch (error) {
      if (!disposed && current === generation) { canvas.textContent = `流程图暂时无法渲染：${(error as Error).message} ${editable ? '点击“编辑源码”修改。' : '请在源码模式中修改。'}`; canvas.classList.add('flow-error'); }
    }
  }
  const refresh = () => { clearTimeout(timer); timer = setTimeout(() => { void render(); }, 180); };
  toggle.onmousedown = event => event.preventDefault();
  toggle.onclick = event => {
    event.preventDefault(); event.stopPropagation(); editing = !editing;
    shell.classList.toggle('flow-editing', editing);
    toggle.textContent = editing ? '预览流程图' : '编辑源码'; toggle.setAttribute('aria-pressed', String(editing));
    if (!editing) void render();
  };
  shell.classList.add('flow-diagram'); shell.classList.toggle('flow-editing', editing); shell.append(canvas);
  if (editable) shell.append(toggle);
  const theme = new MutationObserver(refresh);
  theme.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const resize = new ResizeObserver(refresh); resize.observe(canvas);
  canvas.textContent = '正在生成流程图…'; refresh();
  return {
    canvas, toggle, refresh,
    owns: (target: Node) => canvas.contains(target) || toggle.contains(target),
    destroy() { disposed = true; generation++; clearTimeout(timer); theme.disconnect(); resize.disconnect(); canvas.remove(); toggle.remove(); shell.classList.remove('flow-diagram', 'flow-editing'); },
  };
}
