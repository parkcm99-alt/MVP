'use client';
export default function LensHighlight({text,keyword}:{text:string;keyword:string}){const q=keyword.trim();if(!q)return <>{text}</>;const i=text.toLowerCase().indexOf(q.toLowerCase());if(i<0)return <>{text}</>;return <>{text.slice(0,i)}<mark style={{background:'#facc15',color:'#111827'}}>{text.slice(i,i+q.length)}</mark>{text.slice(i+q.length)}</>}
