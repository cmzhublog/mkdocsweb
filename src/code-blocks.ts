import type { PluginContext, PluginInfo } from '@toast-ui/editor';
import codeSyntaxHighlight from '@toast-ui/editor-plugin-code-syntax-highlight';
import { Prism, highlightCode } from './code-highlighting.ts';
import type { CodeBlockMdNode } from '@toast-ui/editor';
import '@toast-ui/editor-plugin-code-syntax-highlight/dist/toastui-editor-plugin-code-syntax-highlight.css';

export async function copyCode(text: string): Promise<void> {
  if (window.isSecureContext && navigator.clipboard?.writeText) {
    try { await navigator.clipboard.writeText(text); return; } catch { /* HTTP/permission fallback below. */ }
  }
  const selection = window.getSelection();
  const ranges = selection ? Array.from({ length: selection.rangeCount }, (_, i) => selection.getRangeAt(i).cloneRange()) : [];
  const focused = document.activeElement as HTMLElement | null;
  const input = document.createElement('textarea');
  input.value = text;
  input.setAttribute('readonly', '');
  input.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(input);
  input.select();
  try { if (!document.execCommand('copy')) throw new Error('复制失败，请选中代码手动复制'); }
  finally {
    input.remove();
    focused?.focus({ preventScroll: true });
    if (selection) { selection.removeAllRanges(); for (const range of ranges) selection.addRange(range); }
  }
}

function copyButton(read: () => string) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'code-copy';
  button.contentEditable = 'false';
  const feedback = (symbol: string, label: string) => { button.textContent = symbol; button.title = label; button.setAttribute('aria-label', label); };
  feedback('📋', '复制代码');
  button.setAttribute('aria-live', 'polite');
  let timer: ReturnType<typeof setTimeout> | undefined;
  button.onmousedown = event => event.preventDefault();
  button.onclick = async event => {
    event.preventDefault(); event.stopPropagation();
    try { await copyCode(read()); feedback('✅', '已复制代码'); }
    catch { feedback('❌', '复制失败，请选中代码手动复制'); }
    clearTimeout(timer);
    timer = setTimeout(() => feedback('📋', '复制代码'), 2000);
  };
  return { button, destroy: () => clearTimeout(timer) };
}

/** Keep UI outside contentDOM so copying and language labels never enter Markdown. */
export function codeBlocks(context: PluginContext): PluginInfo {
  const plugin = codeSyntaxHighlight(context, { highlighter: Object.assign(Prism, { manual: true }) });
  // The upstream renderer emits unescaped HTML for unsupported languages.
  plugin.toHTMLRenderers = { codeBlock(node) {
    const code = node as CodeBlockMdNode;
    const language = code.info?.trim().split(/\s+/)[0] ?? '';
    return [
      { type: 'openTag', tagName: 'pre' },
      { type: 'openTag', tagName: 'code', attributes: { 'data-language': language || 'text', ...(code.fenceLength > 3 ? { 'data-backticks': String(code.fenceLength) } : {}) } },
      { type: 'html', content: highlightCode(code.literal ?? '', language) },
      { type: 'closeTag', tagName: 'code' },
      { type: 'closeTag', tagName: 'pre' },
    ];
  } };
  const createView = plugin.wysiwygNodeViews!.codeBlock;
  plugin.wysiwygNodeViews!.codeBlock = (...args) => {
    const view = createView(...args);
    const dom = view.dom as HTMLElement;
    dom.classList.add('code-block-shell');
    const copy = copyButton(() => view.contentDOM?.textContent ?? '');
    dom.append(copy.button);
    const ignore = view.ignoreMutation?.bind(view);
    view.ignoreMutation = mutation => copy.button.contains(mutation.target) || mutation.target === copy.button || (ignore?.(mutation) ?? false);
    const destroy = view.destroy?.bind(view);
    view.destroy = () => { copy.destroy(); destroy?.(); };
    return view;
  };
  return plugin;
}

/** Markdown preview is read-only; attach controls without changing its rendered code. */
export function previewCodeCopy(host: HTMLElement) {
  const copies = new Map<HTMLElement, ReturnType<typeof copyButton>>();
  const refresh = () => {
    for (const [shell, copy] of copies) if (!host.contains(shell)) { copy.destroy(); copies.delete(shell); }
    for (const pre of host.querySelectorAll<HTMLElement>('.toastui-editor-md-preview pre')) {
      if (pre.querySelector('.code-copy')) continue;
      pre.classList.add('code-block-shell', 'code-preview-shell');
      pre.dataset.language = pre.querySelector('code')?.getAttribute('data-language') || 'text';
      const copy = copyButton(() => pre.querySelector('code')?.textContent ?? '');
      pre.append(copy.button); copies.set(pre, copy);
    }
  };
  const observer = new MutationObserver(refresh);
  observer.observe(host, { childList: true, subtree: true });
  refresh();
  return () => { observer.disconnect(); for (const copy of copies.values()) copy.destroy(); copies.clear(); };
}
