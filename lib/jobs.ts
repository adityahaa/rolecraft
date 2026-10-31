import type { Job } from './domain';
import { safeUrl } from './domain';
export function plainText(html:string){return html.replace(/<script[\s\S]*?<\/script>/gi,'').replace(/<style[\s\S]*?<\/style>/gi,'').replace(/<\/(p|div|li|h\d)>/gi,'\n').replace(/<[^>]*>/g,' ').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&#(\d+);/g,(_,n)=>{const x=Number(n);return x<0x110000?String.fromCodePoint(x):'';}).replace(/[ \t]+/g,' ').trim().slice(0,20000);}
export function normalizeRemotive(rows:unknown[],time:string):Job[]{
 const seen=new Set<string>();const jobs:Job[]=[];
 for(const raw of rows){const r=raw as Record<string,unknown>;if(typeof r.title!=='string'||typeof r.company_name!=='string'||typeof r.url!=='string'||!safeUrl(r.url))continue;
 const key=(r.company_name+'|'+r.title+'|'+r.candidate_required_location).toLowerCase().replace(/\s+/g,' ');if(seen.has(key))continue;seen.add(key);
 const date=typeof r.publication_date==='string'&&!Number.isNaN(Date.parse(r.publication_date))?new Date(r.publication_date).toISOString():null;
 jobs.push({id:`remotive-${r.id}`,company:r.company_name.slice(0,150),role:r.title.slice(0,150),location:String(r.candidate_required_location||'Not specified').slice(0,150),url:r.url,description:plainText(String(r.description||'')),arrangement:'Remote',source:'Remotive',posted:date,refreshed:time});
 }return jobs;
}
export function filterJobs(jobs:Job[],role:string,location:string,includeRemote:boolean){
 const words=role.toLowerCase().trim().split(/\s+/).filter(Boolean);const place=location.toLowerCase().split(',')[0].trim();
 return jobs.filter(j=>words.every(w=>(j.role+' '+j.description).toLowerCase().includes(w))&&(!place||j.location.toLowerCase().includes(place)||(includeRemote&&j.arrangement==='Remote')));
}
