import React,{useEffect,useState} from 'react';
import {Download,FileText,ShieldCheck} from 'lucide-react';

interface ApprovedFile{
  id:string;
  name:string;
  type:string;
  size:number;
}

const REVIEW_STAGES=new Set(['review','invoiced','completed','paid']);
export function ClientReviewDocuments({token,jobStatus}:{
  token:string;jobStatus:string;
}){
  const [files,setFiles]=useState<ApprovedFile[]>([]);
  const [loading,setLoading]=useState(false);
  const [error,setError]=useState<string|null>(null);
  const visible=REVIEW_STAGES.has(jobStatus);
  useEffect(()=>{
    setFiles([]);setError(null);
    if(!visible)return;
    const ac=new AbortController();
    setLoading(true);
    fetch('/api/portal/'+encodeURIComponent(token)+'/planning/files',{
      signal:ac.signal,credentials:'same-origin',cache:'no-store'
    }).then(async response=>{
      if(response.status===404)return {files:[]};
      if(!response.ok)throw new Error('Approved documents are temporarily unavailable.');
      return response.json();
    }).then(body=>{
      if(ac.signal.aborted)return;
      setFiles(Array.isArray(body?.files)?body.files:[]);
    }).catch(err=>{
      if(!ac.signal.aborted)setError(
        err instanceof Error?err.message:'Could not load approved documents.');
    }).finally(()=>{if(!ac.signal.aborted)setLoading(false)});
    return ()=>ac.abort();
  },[token,visible]);
  if(!visible)return null;
  if(!loading&&!error&&!files.length)return null;
  const base='/api/portal/'+encodeURIComponent(token)+'/planning/files/';
  return (
    <section className="rounded-2xl border border-stone-200 bg-white p-5 shadow-sm"
      aria-label="Approved project documents">
      <div className="flex items-center gap-3">
        <div className="rounded-xl bg-stone-100 p-2 text-stone-600"><ShieldCheck size={19}/></div>
        <div>
          <h3 className="text-sm font-semibold text-stone-900">Approved project documents</h3>
          <p className="text-xs text-stone-500">
            Only documents selected by your Vision79 reviewer appear here.
          </p>
        </div>
      </div>
      {loading&&<p className="mt-4 text-xs text-stone-500">Loading approved documents…</p>}
      {error&&<p role="alert" className="mt-4 text-xs text-rose-700">{error}</p>}
      {!loading&&!error&&files.length>0&&(
        <ul className="mt-4 divide-y divide-stone-100">
          {files.map(file=>(
            <li key={file.id} className="flex items-center gap-3 py-3">
              <FileText size={17} className="shrink-0 text-stone-500"/>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-stone-800">{file.name}</p>
                <p className="text-xs text-stone-500">{Math.round(file.size/1024)} KB</p>
              </div>
              <a href={base+encodeURIComponent(file.id)}
                className="inline-flex items-center gap-1.5 rounded-lg border border-stone-200 px-3 py-1.5 text-xs font-semibold text-stone-700 hover:bg-stone-50"
                download aria-label={'Download '+file.name}>
                <Download size={14}/> Download
              </a>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
