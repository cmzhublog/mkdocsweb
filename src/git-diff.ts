import { structuredPatch } from 'diff';
export interface DiffRow { kind:'added'|'deleted'|'context'|'note'; text:string; oldLine?:number; newLine?:number }
export interface DiffHunk { heading:string; rows:DiffRow[] }
export interface TextDiff { additions:number; deletions:number; hunks:DiffHunk[]; truncated:boolean; unavailable?:string }

/** Calculate full statistics, but bound computation and DOM preview size. */
export function textDiff(before: string, after: string): TextDiff {
  const unavailable=(message:string):TextDiff=>({additions:0,deletions:0,hunks:[],truncated:false,unavailable:message});
  if (before.length+after.length>1000000) return unavailable('文件较大，未计算逐行差异；请在本地 Git 中查看完整差异。');
  const patch=structuredPatch('before','after',before,after,undefined,undefined,{context:3,timeout:150,maxEditLength:4000});
  if (!patch) return unavailable('差异较复杂，已停止计算以保持页面流畅；请在本地 Git 中查看。');
  let additions=0,deletions=0,budget=2000,truncated=false;
  const hunks:DiffHunk[]=[];
  for (const hunk of patch.hunks) {
    let oldLine=hunk.oldStart,newLine=hunk.newStart;
    const rows:DiffRow[]=[];
    for (const line of hunk.lines) {
      const prefix=line[0];
      const row:DiffRow={kind:prefix==='+'?'added':prefix==='-'?'deleted':prefix==='\\'?'note':'context',text:line.slice(1)};
      if (row.kind==='added') { additions++; row.newLine=newLine++; }
      else if (row.kind==='deleted') { deletions++; row.oldLine=oldLine++; }
      else if (row.kind==='context') { row.oldLine=oldLine++; row.newLine=newLine++; }
      if (budget-->0) rows.push(row); else truncated=true;
    }
    if (rows.length) hunks.push({heading:`@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`,rows});
  }
  return {additions,deletions,hunks,truncated};
}
