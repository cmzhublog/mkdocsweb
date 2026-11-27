import { documentImages } from '../src/image-editor.ts';
import test from 'node:test';
import assert from 'node:assert/strict';
import { unzipSync, strFromU8 } from 'fflate';
import { createImageAsset, decodeImage, imageDirectory, imageReference, imageURL, markdownImagePath, renameNoteImages } from '../src/images.ts';
import { documentArchive } from '../src/image-export.ts';
import { mergeWorkspace, parseWorkspace, type Workspace } from '../src/documents.ts';
import { attachRepository, GitHubClient, gitChanges } from '../src/github.ts';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScLbtAAAAABJRU5ErkJggg==';
const sha = (n: number) => n.toString(16).padStart(40,'0');
function workspace(): Workspace { return { notes: [{ id:'note', title:'test', content:'# test',updatedAt:1 }],folders:[],activeId:'note' }; }
async function addImage(w: Workspace) { const asset = await createImageAsset(w.notes[0],new Blob([decodeImage(png)],{type:'image/png'})); (w.images??=[]).push(asset); return asset; }

test('test.md 图片归入同级 test.assets，重复粘贴生成唯一名称',async()=>{
 const w=workspace();const a=await addImage(w);const b=await addImage(w);
 assert.equal(imageDirectory(w.notes[0]),'test.assets');assert.equal(a.folder,'test.assets');assert.notEqual(a.name,b.name);assert.equal(a.mime,'image/png');assert.equal(a.base64,png);
 assert.equal(imageURL('alice','note',markdownImagePath(imageReference(a))),`/api/images/alice/note?path=${encodeURIComponent(imageReference(a))}`);
 assert.equal(imageURL('alice','note','https://example.com/image.png'),'https://example.com/image.png');
 await assert.rejects(createImageAsset(w.notes[0],new Blob(['<svg onload="alert(1)"/>'],{type:'image/png'})),/PNG/);
});
test('重命名文档同步自有图片目录和引用，不改其他图片或代码示例',async()=>{
 const w=workspace();const a=await addImage(w);const old=imageReference(a);
 w.notes[0].content=`![图片](${old})\n![other](other.assets/a.png)\n\`${'![图片]('+old+')'}\`\n\`\`\`md\n![图片](${old})\n\`\`\``;
 w.notes[0].title='新 文档';renameNoteImages(w,w.notes[0]);
 assert.equal(a.folder,'新 文档.assets');assert.ok(w.notes[0].content.startsWith(`![图片](${markdownImagePath(imageReference(a))})`));assert.ok(w.notes[0].content.includes(`\`![图片](${old})\``));assert.ok(w.notes[0].content.includes(`\n![图片](${old})\n`));assert.ok(w.notes[0].content.includes('other.assets/a.png'));
});
test('JSON 备份保留图片，恢复重映射所属文档并拒绝伪造图片数据',async()=>{
 const w=workspace();await addImage(w);assert.deepEqual(parseWorkspace(JSON.stringify(w)),w);
 const target=workspace();mergeWorkspace(target,w);assert.notEqual(target.images![0].noteId,'note');assert.ok(target.notes.some(n=>n.id===target.images![0].noteId));
 w.images![0].base64=btoa('<html>not an image</html>');assert.equal(parseWorkspace(JSON.stringify(w)),null);
});
test('ZIP 同时包含 test.md 和 test.assets 图片原始二进制',async()=>{
 const w=workspace();const a=await addImage(w);w.notes[0].content=`![图片](${imageReference(a)})`;
 const zip=await documentArchive(w,w.notes[0],async()=>{throw new Error('unexpected remote read')});const files=unzipSync(zip);
 assert.equal(strFromU8(files['test.md']),w.notes[0].content);assert.deepEqual(files[imageReference(a)],decodeImage(png));
});
test('Git 保留已有图片，新图片位于文档同级目录并使用 base64 blob 提交',async()=>{
 const w=workspace();const repo=attachRepository(w,{owner:'demo',repo:'docs',branch:'main',headSha:sha(1),treeSha:sha(2),files:[{path:'folder/test.md',content:'# test',sha:sha(3),mode:'100644'}],imageFiles:[{path:'unrelated.png',sha:sha(4),mode:'100644'}],allPaths:['folder/test.md','unrelated.png']});
 const note=w.notes.find(n=>n.folderId!==undefined)!;const asset=await createImageAsset(note,new Blob([decodeImage(png)]));w.images=[asset];const changes=gitChanges(w,repo);
 assert.equal(changes.length,1);assert.equal(changes[0].path,`folder/test.assets/${asset.name}`);assert.equal(changes[0].base64,png);
 const calls:{path:string;body:any}[]=[];
 const fetchMock=(async(input,options)=>{const path=new URL(String(input)).pathname;const body=options?.body?JSON.parse(String(options.body)):undefined;calls.push({path,body});if(path.includes('/git/ref/'))return Response.json({object:{sha:sha(1)}});if(path.endsWith('/git/blobs'))return Response.json({sha:sha(5)});if(path.endsWith('/git/trees'))return Response.json({sha:sha(6)});if(path.endsWith('/git/commits'))return Response.json({sha:sha(7)});return Response.json({});}) as typeof fetch;
 const result=await new GitHubClient('token',fetchMock).push(repo,changes,'add image');
 assert.deepEqual(calls.find(c=>c.path.endsWith('/git/blobs'))?.body,{content:png,encoding:'base64'});
 assert.deepEqual(calls.find(c=>c.path.endsWith('/git/trees'))?.body.tree,[{path:`folder/test.assets/${asset.name}`,mode:'100644',type:'blob',sha:sha(5)}]);
 asset.remote={repositoryId:repo.id,path:changes[0].path,sha:result.blobs![changes[0].path]};repo.imageFiles!.push({path:changes[0].path,sha:sha(5),mode:'100644'});assert.deepEqual(gitChanges(w,repo),[]);
 note.title='renamed';renameNoteImages(w,note);assert.deepEqual(gitChanges(w,repo).map(c=>[c.path,c.kind]),[[`folder/renamed.assets/${asset.name}`,'added'],['folder/renamed.md','added'],[`folder/test.assets/${asset.name}`,'deleted'],['folder/test.md','deleted']]);
});

test('图片预览保留 alt、跳过替代文字子节点，重命名不改变图片读取地址',async()=>{
 const w=workspace();const asset=await addImage(w);const renderer=documentImages('alice','note',w)().toHTMLRenderers!.image as Function;
 let skipped=false;const context={entering:true,getChildrenText:()=> '图片说明',skipChildren:()=>{skipped=true}};
 const before=renderer({destination:markdownImagePath(imageReference(asset))},context);
 assert.equal(skipped,true);assert.equal(before.attributes.alt,'图片说明');
 w.notes[0].title='renamed';renameNoteImages(w,w.notes[0]);
 const after=renderer({destination:markdownImagePath(imageReference(asset))},context);
 assert.equal(before.attributes.src,after.attributes.src);assert.deepEqual(renderer({}, {...context,entering:false}),[]);
});

test('旧版仓库缺少图片元信息时，ZIP 仍按 Markdown 引用读取同级 assets 图片',async()=>{
 const w=workspace();const repo=attachRepository(w,{owner:'demo',repo:'docs',branch:'main',headSha:sha(1),treeSha:sha(2),files:[{path:'test.md',content:'![旧图片](test.assets/old.png)',sha:sha(3),mode:'100644'}],allPaths:['test.md','test.assets/old.png']});
 delete repo.imageFiles;
 const note=w.notes.find(n=>n.folderId===repo.rootFolderId)!;
 const files=unzipSync(await documentArchive(w,note,async relative=>{assert.equal(relative,'test.assets/old.png');return decodeImage(png)}));
 assert.deepEqual(files['test.assets/old.png'],decodeImage(png));
});
