import { createElement, Copy, Check, X } from 'lucide';
import { isFlowLanguage } from './flow-source.ts';
import { flowPreview } from './flow-diagrams';
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
  const tooltip = document.createElement('span');
  tooltip.className = 'code-copy-tooltip';
  tooltip.setAttribute('aria-hidden', 'true');
  const feedback = (status: 'copy' | 'success' | 'error', label: string) => {
    const icon = createElement(status === 'success' ? Check : status === 'error' ? X : Copy);
    icon.setAttribute('aria-hidden', 'true');
    button.replaceChildren(icon, tooltip);
    tooltip.textContent = label;
    button.setAttribute('aria-label', status === 'copy' ? '复制代码' : label);
  };
  feedback('copy', '复制');
  button.setAttribute('aria-live', 'polite');
  let timer: ReturnType<typeof setTimeout> | undefined;
  button.onmousedown = event => event.preventDefault();
  button.onclick = async event => {
    event.preventDefault(); event.stopPropagation();
    try { await copyCode(read()); feedback('success', '已复制'); }
    catch { feedback('error', '复制失败，请选中代码手动复制'); }
    clearTimeout(timer);
    timer = setTimeout(() => feedback('copy', '复制'), 2000);
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
    const flow = isFlowLanguage(args[0].attrs.language ?? '') ? flowPreview(dom, () => view.contentDOM?.textContent ?? '', true, !args[0].textContent.trim()) : undefined;
    const update = view.update?.bind(view);
    view.update = (...params) => { const result = update?.(...params) ?? false; if (result) flow?.refresh(); return result; };
    const ignore = view.ignoreMutation?.bind(view);
    view.ignoreMutation = mutation => (flow?.owns(mutation.target) ?? false) || (mutation.type === 'attributes' && mutation.target === dom) || copy.button.contains(mutation.target) || mutation.target === copy.button || (ignore?.(mutation) ?? false);
    const destroy = view.destroy?.bind(view);
    view.destroy = () => { flow?.destroy(); copy.destroy(); destroy?.(); };
    return view;
  };
  return plugin;
}

/** Markdown preview is read-only; attach controls without changing its rendered code. */
export function previewCodeCopy(host: HTMLElement) {
  const copies = new Map<HTMLElement, { copy: ReturnType<typeof copyButton>; flow?: ReturnType<typeof flowPreview> }>();
  const refresh = () => {
    for (const [shell, controls] of copies) if (!host.contains(shell) || !shell.querySelector('.code-copy')) { controls.flow?.destroy(); controls.copy.destroy(); copies.delete(shell); }
    for (const pre of host.querySelectorAll<HTMLElement>('.toastui-editor-md-preview pre')) {
      if (pre.querySelector('.code-copy')) { copies.get(pre)?.flow?.refresh(); continue; }
      pre.classList.add('code-block-shell', 'code-preview-shell');
      pre.dataset.language = pre.querySelector('code')?.getAttribute('data-language') || 'text';
      const copy = copyButton(() => pre.querySelector('code')?.textContent ?? '');
      pre.append(copy.button);
      const flow = isFlowLanguage(pre.dataset.language) ? flowPreview(pre, () => pre.querySelector('code')?.textContent ?? '', false) : undefined;
      copies.set(pre, { copy, flow });
    }
  };
  const observer = new MutationObserver(refresh);
  observer.observe(host, { childList: true, subtree: true });
  refresh();
  return () => { observer.disconnect(); for (const controls of copies.values()) { controls.flow?.destroy(); controls.copy.destroy(); } copies.clear(); };
}
