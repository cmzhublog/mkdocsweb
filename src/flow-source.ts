export const isFlowLanguage = (language: string) => /^(flow|flowchart)$/i.test(language);

export function checkFlowSource(source: string) {
  if (!source.trim()) throw new Error('请输入流程图节点和连线。');
  if (source.length > 30000 || source.split('\n').length > 500) throw new Error('流程图过大，请拆分后预览。');
  const definitions = [...source.matchAll(/^\s*([^\s=()]+)=>(start|end|operation|inputoutput|input|output|subroutine|condition|parallel)\s*:/gm)];
  if (!definitions.length || !source.includes('->')) throw new Error('请检查节点定义（st=>start: 开始）和连线（st->e）。');
  if (definitions.length > 150) throw new Error('流程图节点过多，请拆分后预览。');
  const ids = new Set(definitions.map(match => match[1]));
  for (const line of source.split('\n')) {
    if (!line.includes('->') || line.includes('=>')) continue;
    for (const part of line.split('->')) {
      const id = part.trim().split('(')[0];
      if (id && !ids.has(id)) throw new Error(`连线引用了未定义节点：${id}`);
    }
  }
}
