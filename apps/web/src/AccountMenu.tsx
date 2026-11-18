import {useRef,useState} from 'react';
import {LogOut,Settings2,User,Library} from 'lucide-react';
import type {Account} from './api';
import {Button, MenuTrigger} from './ui/controls';
import {useDismissablePopover} from './ui/overlays';

export function AccountMenu({account,active,busy,onAccount,onPractices,onPreferences,onSignOut}:{account:Account|null;active:boolean;busy:boolean;onAccount:()=>void;onPractices:()=>void;onPreferences:()=>void;onSignOut:()=>void}){
 const [open,setOpen]=useState(false),root=useRef<HTMLDivElement>(null),trigger=useRef<HTMLButtonElement>(null),menu=useRef<HTMLDivElement>(null),firstItem=useRef<HTMLButtonElement>(null);
 const close=(restore=false)=>{setOpen(false);if(restore)trigger.current?.focus();};
 useDismissablePopover({open,onClose:()=>setOpen(false),rootRef:root,triggerRef:trigger,initialFocusRef:firstItem,closeOnFocusOutside:true});
 const choose=(action:()=>void)=>{close();action();};
 if(!account)return <Button variant="feed-sign-in" className="feed-sign-in" onClick={onAccount}><User size={18}/><span>Sign in</span></Button>;
 return <div className="account-menu" ref={root}>
  <MenuTrigger ref={trigger} variant="feed-profile" className={`feed-profile ${active?'active':''}`} aria-label="Account menu" title={account.email} aria-haspopup="menu" aria-expanded={open} aria-controls="account-menu-options" onClick={()=>setOpen(value=>!value)} onKeyDown={event=>{if(event.key==='ArrowDown'){event.preventDefault();setOpen(true);}if(event.key==='Escape')close(true);}}>{account.email.slice(0,1).toUpperCase()}</MenuTrigger>
  {open&&<div ref={menu} id="account-menu-options" className="account-menu-options" role="menu" aria-label="Account" onKeyDown={event=>{
   const buttons=Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')??[]),index=buttons.indexOf(document.activeElement as HTMLButtonElement);
   if(event.key==='Escape'){event.preventDefault();close(true);}
   else if(['ArrowDown','ArrowUp','Home','End'].includes(event.key)){event.preventDefault();buttons[event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length]?.focus();}
  }}>
   <p className="account-menu-identity">{account.email}</p>
   <Button ref={firstItem} variant="feed-menu-row" role="menuitem" onClick={()=>choose(onAccount)}><User size={17}/>Account</Button>
   <Button variant="feed-menu-row" role="menuitem" onClick={()=>choose(onPractices)}><Library size={17}/>My practices</Button>
   <Button variant="feed-menu-row" role="menuitem" onClick={()=>choose(onPreferences)}><Settings2 size={17}/>Preferences</Button>
   <Button variant="feed-menu-row" role="menuitem" disabled={busy} onClick={()=>choose(onSignOut)}><LogOut size={17}/>Sign out</Button>
  </div>}
 </div>;
}
