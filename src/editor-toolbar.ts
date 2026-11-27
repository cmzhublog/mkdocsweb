/** Keep Toast UI's own controls and commands, with a single scrolling header. */
export function createEditorToolbar(host: HTMLElement) {
  const toolbar = host.querySelector<HTMLElement>('.toastui-editor-toolbar')!;
  const buttons = toolbar.querySelector<HTMLElement>('.toastui-editor-defaultUI-toolbar')!;
  const viewport = document.createElement('div'); viewport.className = 'editor-tools-scroll';
  viewport.tabIndex = 0; viewport.setAttribute('role', 'region');
  viewport.setAttribute('aria-label', '文档编辑工具，左右滚动查看全部选项');
  const row = document.createElement('div'); row.className = 'editor-tools-row';
  toolbar.classList.add('document-format-toolbar'); row.append(toolbar); viewport.append(row);
  let anchor: HTMLElement | null = null;
  const number = (value: string) => Number.parseFloat(value) || 0;
  function refresh() {
    const button = buttons.querySelector<HTMLElement>('.toastui-editor-toolbar-icons');
    if (!button || !viewport.isConnected) return;
    const style = getComputedStyle(button);
    const divider = buttons.querySelector<HTMLElement>('.toastui-editor-toolbar-divider');
    const dividerStyle = divider ? getComputedStyle(divider) : null;
    const itemWidth = number(style.width) + number(style.marginLeft) + number(style.marginRight);
    const dividerWidth = dividerStyle ? number(dividerStyle.width) + number(dividerStyle.marginLeft) + number(dividerStyle.marginRight) : 25;
    // The configured 14 controls / five groups retain their original dimensions.
    // Toast UI reserves 50px when deciding whether to collapse items into “more”.
    const width = `${Math.ceil(itemWidth * 14 + dividerWidth * 4 + 50)}px`;
    if (toolbar.style.width !== width) toolbar.style.width = width;
    viewport.dataset.start = String(viewport.scrollLeft <= 1);
    viewport.dataset.end = String(viewport.scrollLeft + viewport.clientWidth >= viewport.scrollWidth - 1);
    positionPopups();
  }
  function positionPopups() {
    if (!anchor || !viewport.isConnected) return;
    const rect = anchor.getBoundingClientRect();
    for (const popup of toolbar.querySelectorAll<HTMLElement>('.toastui-editor-popup, .toastui-editor-tooltip')) {
      if (getComputedStyle(popup).display === 'none') continue;
      const bounds = popup.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.left, window.innerWidth - bounds.width - 8));
      const top = rect.bottom + 8 + bounds.height > window.innerHeight - 8 ? Math.max(8, rect.top - bounds.height - 8) : rect.bottom + 8;
      if (popup.style.left !== `${left}px`) popup.style.left = `${left}px`;
      if (popup.style.top !== `${top}px`) popup.style.top = `${top}px`;
    }
  }
  const rememberAnchor = (event: Event) => {
    const button = (event.target as Element).closest<HTMLElement>('button');
    if (button && buttons.contains(button)) anchor = button;
  };
  toolbar.addEventListener('pointerover', rememberAnchor);
  toolbar.addEventListener('click', rememberAnchor, true);
  new MutationObserver(positionPopups).observe(toolbar, { subtree: true, childList: true, attributes: true, attributeFilter: ['style'] });
  new ResizeObserver(refresh).observe(viewport);
  viewport.addEventListener('scroll', refresh, { passive: true });
  viewport.addEventListener('wheel', event => {
    if (event.ctrlKey || event.shiftKey || Math.abs(event.deltaX) >= Math.abs(event.deltaY) || viewport.scrollWidth <= viewport.clientWidth) return;
    const delta = event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientWidth : 1);
    const next = Math.max(0, Math.min(viewport.scrollWidth - viewport.clientWidth, viewport.scrollLeft + delta));
    if (next !== viewport.scrollLeft) { event.preventDefault(); viewport.scrollLeft = next; }
  }, { passive: false });
  viewport.addEventListener('keydown', event => {
    if (event.target !== viewport || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home') viewport.scrollLeft = 0;
    else if (event.key === 'End') viewport.scrollLeft = viewport.scrollWidth;
    else viewport.scrollBy({ left: event.key === 'ArrowRight' ? 140 : -140 });
  });
  viewport.addEventListener('focusin', event => {
    if (event.target instanceof HTMLElement && event.target !== viewport && !event.target.closest('.toastui-editor-popup')) event.target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
  return { viewport, row, refresh };
}
