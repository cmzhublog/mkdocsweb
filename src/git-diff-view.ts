import type { GitChange, GitRepository } from './git-types';
import { textDiff, type TextDiff } from './git-diff.ts';
const esc=(value:string)=>value.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const labels={added:'新增文件',modified:'修改文件',deleted:'删除文件'};
const symbols={added:'A',modified:'M',deleted:'D'};

export function changeReview(repository: GitRepository, changes: GitChange[], load: (sha:string)=>Promise<string>) {
  const root=document.createElement('div'); root.className='git-review';
  if (!changes.length) { root.innerHTML='<p class="git-help">没有需要提交的文档更改。</p>'; return root; }
  root.innerHTML='<div class="git-review-summary" aria-live="polite"></div><div class="git-review-files"></div>';
  const results=new Map<number,TextDiff>();
  const loads=new Map<string,Promise<string>>();
  const read=(sha:string) => { let pending=loads.get(sha); if (!pending) { pending=load(sha).catch(error=>{loads.delete(sha);throw error;});loads.set(sha,pending); } return pending; };
  const binary=(change:GitChange)=>change.base64!==undefined || !!repository.imageFiles?.some(f=>f.path===change.path) || /\.(png|jpe?g|gif|webp)$/i.test(change.path);
  const original=(change:GitChange)=>repository.files.find(f=>f.path===change.path);
  const current=(change:GitChange)=>change.content ?? (change.sha ? repository.files.find(f=>f.sha===change.sha)?.content : undefined);
  function counts(diff?:TextDiff) {
    if (!diff) return '<span class="git-diff-pending">展开统计</span>';
    if (diff.unavailable) return '<span class="git-diff-pending">未计算</span>';
    const total=diff.additions+diff.deletions;
    return `<span class="git-diff-counts" aria-label="新增 ${diff.additions} 行，删除 ${diff.deletions} 行"><span class="git-diff-add">+${diff.additions}</span><span class="git-diff-delete">−${diff.deletions}</span><span class="git-diff-bar" aria-hidden="true"><i style="width:${total ? diff.additions/total*100 : 0}%"></i><i style="width:${total ? diff.deletions/total*100 : 0}%"></i></span></span>`;
  }
  function totals() {
    let additions=0,deletions=0,pending=0,skipped=0;
    changes.forEach((change,index)=>{ if (binary(change)) return; const diff=results.get(index); if (!diff) pending++; else if (diff.unavailable) skipped++; else {additions+=diff.additions;deletions+=diff.deletions;} });
    const count=(kind:GitChange['kind'])=>changes.filter(c=>c.kind===kind).length;
    root.querySelector('.git-review-summary')!.innerHTML=`<strong>${changes.length} 个文件</strong><span class="git-file-added">新增 ${count('added')}</span><span class="git-file-modified">修改 ${count('modified')}</span><span class="git-file-deleted">删除 ${count('deleted')}</span><span class="git-diff-add">+${additions}</span><span class="git-diff-delete">−${deletions}</span>${pending ? `<span class="git-diff-pending">${pending} 项待统计（展开读取）</span>` : ''}${skipped ? `<span class="git-diff-pending">${skipped} 项未计算</span>` : ''}`;
  }
  function renderDiff(container:HTMLElement,diff:TextDiff) {
    if (diff.unavailable) { container.textContent=diff.unavailable;container.classList.add('git-diff-message');return; }
    if (!diff.hunks.length) { container.innerHTML='<p class="git-help">内容未变化，仅路径或文件属性发生变化。</p>';return; }
    container.innerHTML=`<div class="git-diff-scroll" tabindex="0" role="region" aria-label="逐行差异"><table class="git-diff-table" aria-label="红色删除、绿色新增；左列原行号，右列新行号"><tbody>${diff.hunks.map(h=>`<tr class="git-diff-hunk"><td colspan="4">${esc(h.heading)}</td></tr>${h.rows.map(row=>`<tr class="git-diff-${row.kind}"><td class="git-diff-number">${row.oldLine??''}</td><td class="git-diff-number">${row.newLine??''}</td><td class="git-diff-sign">${row.kind==='added'?'+':row.kind==='deleted'?'−':row.kind==='note'?'\\':''}</td><td class="git-diff-code">${esc(row.text)}</td></tr>`).join('')}`).join('')}</tbody></table></div>${diff.truncated?'<p class="git-help">仅显示前 2000 行差异，增删统计包含完整计算结果。</p>':''}`;
  }
  changes.forEach((change,index)=>{
    const before=change.kind==='added'?'':original(change)?.content;
    const after=change.kind==='deleted'?'':current(change);
    if (!binary(change) && before!==undefined && after!==undefined) results.set(index,textDiff(before,after));
    const details=document.createElement('details');details.className=`git-change git-file-${change.kind}`;
    details.innerHTML=`<summary><span class="git-diff-chevron" aria-hidden="true">›</span><span class="git-file-status" title="${labels[change.kind]}">${symbols[change.kind]}</span><span class="git-change-kind ${change.kind}">${labels[change.kind]}</span><span class="git-diff-path">${esc(change.path)}</span><span class="git-diff-stat">${binary(change)?'<span class="git-diff-pending">二进制</span>':counts(results.get(index))}</span></summary><div class="git-change-content"></div>`;
    let busy=false,done=false;
    async function preview() {
      if (!details.open || busy || done) return;
      const container=details.querySelector<HTMLElement>('.git-change-content')!;
      if (binary(change)) { container.classList.add('git-diff-message');container.textContent=change.kind==='deleted'?'删除此图片文件。':`图片文件，不计算文本行差异${change.base64!==undefined?`，约 ${Math.ceil(change.base64.length*.75/1024)} KiB`:''}。`;done=true;return; }
      busy=true;container.textContent='正在按固定版本读取原文并计算差异…';
      try {
        let diff=results.get(index);
        if (!diff) {
          const baseline=original(change);
          const oldText=before ?? (baseline?.sha ? await read(baseline.sha) : undefined);
          const newText=after ?? (change.sha ? await read(change.sha) : undefined);
          if (oldText===undefined || newText===undefined) throw new Error('缺少对比版本，无法计算行差异；文档不会被当作空白处理。');
          diff=textDiff(oldText,newText);results.set(index,diff);
        }
        renderDiff(container,diff);done=true;
        details.querySelector('.git-diff-stat')!.innerHTML=counts(diff);totals();
      } catch(error) {
        container.replaceChildren();
        const message=document.createElement('p');message.className='git-help';message.textContent=(error as Error).message;
        const retry=document.createElement('button');retry.type='button';retry.className='git-diff-retry';retry.textContent='重试读取';retry.onclick=()=>{void preview();};container.append(message,retry);
      } finally {busy=false;}
    }
    details.ontoggle=()=>{void preview();};
    root.querySelector('.git-review-files')!.append(details);
  });
  totals();return root;
}
