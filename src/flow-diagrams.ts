import DOMPurify from 'dompurify';
import { checkFlowSource } from './flow-source.ts';

let library: Promise<typeof import('flowchart.js')> | undefined;

/** Render locally, then remove interactive/external SVG content before display. */
export async function flowSVG(source: string): Promise<string> {
  checkFlowSource(source);
  const flowchart = await (library ??= import('flowchart.js').then(module => (module as unknown as { default: typeof import('flowchart.js') }).default).catch(error => { library = undefined; throw error; }));
  const scratch = document.createElement('div');
  scratch.style.cssText = 'position:fixed;left:-100000px;top:0;width:1200px;visibility:hidden;pointer-events:none';
  document.body.append(scratch);
  const colors = getComputedStyle(document.documentElement);
  const color = (name: string) => colors.getPropertyValue(name).trim();
  let chart: ReturnType<typeof flowchart.parse> | undefined;
  try {
    chart = flowchart.parse(source);
    chart.drawSVG(scratch, { 'line-width': 1.5, 'line-length': 40, 'text-margin': 12, 'font-size': 14, 'font-family': 'system-ui, sans-serif', 'font-color': color('--ink') || '#263a30', 'line-color': color('--green') || '#34664c', 'element-color': color('--green') || '#34664c', fill: color('--paper') || '#fff', 'yes-text': '是', 'no-text': '否', maxWidth: 220, scale: 1 });
    const svg = scratch.querySelector('svg');
    if (!svg || !svg.querySelector('text')) throw new Error('无法生成流程图，请检查语法。');
    const width = Number.parseFloat(svg.getAttribute('width') ?? '0');
    const height = Number.parseFloat(svg.getAttribute('height') ?? '0');
    if (!width || !height || !Number.isFinite(width + height) || width + height > 100000) throw new Error('流程图尺寸无效，请简化内容。');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('role', 'img'); svg.setAttribute('aria-label', '流程图');
    svg.style.cssText = `display:block;width:${width}px;max-width:none;height:auto;min-width:${Math.min(width, 600)}px;margin:auto`;
    for (const element of svg.querySelectorAll('*')) {
      for (const attr of Array.from(element.attributes)) {
        if ((attr.localName === 'href') && !/^#[\w-]+$/.test(attr.value)) element.removeAttributeNode(attr);
      }
    }
    return DOMPurify.sanitize(svg.outerHTML, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['use'], ADD_ATTR: ['href', 'xlink:href'], FORBID_TAGS: ['a', 'image', 'foreignObject', 'script', 'animate', 'set'], FORBID_ATTR: ['onclick', 'onload'] });
  } finally { chart?.clean(); scratch.remove(); }
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
    const source = read(); const nextKey = `${document.documentElement.dataset.theme}:${source}`;
    if (nextKey === key || disposed) return;
    key = nextKey; const current = ++generation;
    canvas.textContent = '正在生成流程图…';
    try {
      const svg = await flowSVG(source);
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
  canvas.textContent = '正在生成流程图…'; refresh();
  return {
    canvas, toggle, refresh,
    owns: (target: Node) => canvas.contains(target) || toggle.contains(target),
    destroy() { disposed = true; generation++; clearTimeout(timer); theme.disconnect(); canvas.remove(); toggle.remove(); shell.classList.remove('flow-diagram', 'flow-editing'); },
  };
}
