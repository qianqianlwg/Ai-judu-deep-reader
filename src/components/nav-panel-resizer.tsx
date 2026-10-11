"use client";
import {useCallback,type RefObject} from 'react';
import {maxNavWidth} from '@/lib/chat-layout';
import {ChatPanelResizer} from './chat-panel-resizer';
type Props={containerRef:RefObject<HTMLElement|null>;assistantHidden?:boolean;onWidthChange:(width:number)=>void};
export function NavPanelResizer({containerRef,assistantHidden=false,onWidthChange}:Props){
 const getMaxWidth=useCallback((width:number)=>maxNavWidth(width,assistantHidden),[assistantHidden]);
 // WHY：复用分隔器的拖动、键盘、偏好恢复和清理机制，不另造一套窗口事件监听。
 return <ChatPanelResizer side="left" panelName="目录" defaultWidth={220} minWidth={160} narrowBreakpoint={960}
  containerRef={containerRef} getMaxWidth={getMaxWidth} onWidthChange={onWidthChange} storageKey="judu:nav-panel-width" controlsId="workspace-navigation" className="workspace-nav-resizer"/>;
}
