"use client";
import {useEffect,useState} from 'react';
export function useNavCollapse() {
  const [collapsed,setCollapsed]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const frame=requestAnimationFrame(()=>{try{setCollapsed(localStorage.getItem('judu:nav-collapsed')==='true');}catch(cause:unknown){console.warn('读取导航偏好失败',cause);setError('无法读取导航偏好');}});return()=>cancelAnimationFrame(frame);},[]);
  function toggle(){const next=!collapsed;setCollapsed(next);try{localStorage.setItem('judu:nav-collapsed',String(next));setError('');}catch(cause:unknown){console.warn('保存导航偏好失败',cause);setError('导航已切换，但偏好保存失败');}}
  return {collapsed,toggle,error};
}
