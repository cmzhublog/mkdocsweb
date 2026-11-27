import { createElement, Trash2 } from 'lucide';

/** A shared menu outside the scrolling tree; opening it never selects a note. */
export function createFileMenu(list: HTMLElement, remove: (id:string)=>void) {
  const menu=document.createElement('div');menu.className='note-file-menu';menu.hidden=true;menu.setAttribute('role','menu');
  const action=document.createElement('button');action.type='button';action.setAttribute('role','menuitem');
  const icon=createElement(Trash2);icon.setAttribute('aria-hidden','true');
  action.append(icon,document.createTextNode('删除当前文件'));menu.append(action);document.body.append(menu);
  let trigger:HTMLButtonElement|null=null, noteId='';
  function close(restoreFocus=false) {
    const previous=trigger;
    previous?.setAttribute('aria-expanded','false');trigger=null;noteId='';menu.hidden=true;
    if (restoreFocus && previous?.isConnected) previous.focus();
  }
  function open(button:HTMLButtonElement) {
    if (trigger===button && !menu.hidden) {close(true);return;}
    close();trigger=button;noteId=button.dataset.noteMenu!;button.setAttribute('aria-expanded','true');
    menu.setAttribute('aria-label',button.getAttribute('aria-label') || '文件操作');menu.hidden=false;
    const rect=button.getBoundingClientRect(),box=menu.getBoundingClientRect();
    menu.style.left=`${Math.max(8,Math.min(rect.right-box.width,window.innerWidth-box.width-8))}px`;
    menu.style.top=`${rect.bottom+box.height+6<=window.innerHeight-8 ? rect.bottom+6 : Math.max(8,rect.top-box.height-6)}px`;
    action.focus();
  }
  list.addEventListener('click',event=>{
    const button=(event.target as Element).closest<HTMLButtonElement>('[data-note-menu]');
    if (!button) return;
    event.preventDefault();event.stopPropagation();open(button);
  });
  list.addEventListener('keydown',event=>{
    const button=(event.target as Element).closest<HTMLButtonElement>('[data-note-menu]');
    if (button && ['ArrowDown','ArrowUp'].includes(event.key)) {event.preventDefault();event.stopPropagation();open(button);}
  });
  menu.addEventListener('keydown',event=>{
    if (event.key==='Escape') {event.preventDefault();event.stopPropagation();close(true);}
    else if (event.key==='ArrowDown'||event.key==='ArrowUp') {event.preventDefault();action.focus();}
    else if (event.key==='Tab') close(true);
  });
  action.onclick=()=>{const id=noteId;close(true);if(id)remove(id);};
  document.addEventListener('click',event=>{if(!menu.contains(event.target as Node)&&!(event.target as Element).closest('[data-note-menu]'))close();});
  window.addEventListener('resize',()=>close());
  window.addEventListener('scroll',()=>close(),true);
  return {close};
}
