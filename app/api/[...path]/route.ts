import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { createHash } from 'node:crypto';
import { AppError,db,user,configured,setSession,clearSession,quota,storageError,oauthClient } from '@/lib/server';
import { applicationSchema,documentSchema,profileSchema,SKILLS } from '@/lib/domain';
import { filterJobs,normalizeRemotive } from '@/lib/jobs';
import { exportDocx,exportPdf,extractFile,DocumentInputError } from '@/lib/documents';
export const runtime='nodejs';
export const maxDuration=60;
const json=(data:unknown,status=200)=>NextResponse.json(data,{status,headers:{'Cache-Control':'no-store'}});
async function body(req:NextRequest){const text=await req.text();if(text.length>100000)throw new AppError(413,'Request is too large.');return JSON.parse(text);}
function csrf(req:NextRequest){const origin=req.headers.get('origin');if(!origin||origin!==req.nextUrl.origin)throw new AppError(403,'Please submit this request from the application.');}
function subject(req:NextRequest){return createHash('sha256').update((req.headers.get('x-real-ip')||'local')+(process.env.SUPABASE_SERVICE_ROLE_KEY||'local')).digest('hex');}
async function jobs(req:NextRequest){
 if(!configured())return json({jobs:[],warning:'Live discovery is waiting for shared-cache setup. Paste a job description to continue.',fetched_at:null,next_attempt:null,total:0});
 const admin=db(undefined,true);const {data:claimed,error:claimError}=await admin.rpc('claim_job_refresh');storageError(claimError);
 if(claimed){try{const response=await fetch('https://remotive.com/api/remote-jobs',{signal:AbortSignal.timeout(12000),cache:'no-store'});if(!response.ok)throw new Error('Source unavailable');const raw=await response.json();if(!Array.isArray(raw.jobs))throw new Error('Invalid source response');const time=new Date().toISOString();const {error}=await admin.from('job_cache').update({payload:normalizeRemotive(raw.jobs,time),fetched_at:time,error:null}).eq('source','remotive');storageError(error);}catch{await admin.from('job_cache').update({error:'Remotive is unavailable or rate limited. Showing the last successful snapshot, if any; links may have expired.'}).eq('source','remotive');}}
 const {data,error}=await admin.from('job_cache').select('*').eq('source','remotive').single();storageError(error);
 const role=req.nextUrl.searchParams.get('role')?.slice(0,150)||'';const location=req.nextUrl.searchParams.get('location')?.slice(0,150)||'';
 return json({jobs:filterJobs(data.payload,role,location,req.nextUrl.searchParams.get('remote')==='true').slice(0,100),warning:data.error,fetched_at:data.fetched_at,next_attempt:data.next_attempt,total:data.payload.length});
}
async function handle(req:NextRequest,context:{params:Promise<{path:string[]}>}){
 try{
  const segments=(await context.params).path;const route=segments.join('/');const method=req.method;
  if(method!=='GET')csrf(req);
  if(Number(req.headers.get('content-length')||0)>3.2*1024*1024)throw new AppError(413,'Upload must be 3 MB or smaller.');
  if(route==='auth/github'&&method==='POST'){
   const client=await oauthClient();const {data,error}=await client.auth.signInWithOAuth({provider:'github',options:{redirectTo:new URL('/api/auth/callback',req.url).toString(),skipBrowserRedirect:true}});
   if(error||!data.url)throw new AppError(503,'GitHub sign-in is unavailable. Please try later.');return json({url:data.url});
  }
  if(route==='auth/callback'&&method==='GET'){
   const code=req.nextUrl.searchParams.get('code');const flowId=req.nextUrl.searchParams.get('sb_flow_id');
   try{if(!code||!flowId)throw new Error();const client=await oauthClient();const {data,error}=await client.auth.exchangeCodeForSession(code,{flowId});if(error||!data.session)throw new Error();await setSession(data.session);return NextResponse.redirect(new URL('/',req.url));}catch{return NextResponse.redirect(new URL('/?auth_error=1',req.url));}
  }
  if(route==='health')return json({sync:configured(),ai:!!process.env.GEMINI_API_KEY&&configured()&&process.env.GEMINI_FREE_TIER_CONFIRMED==='true',model:'gemini-2.5-flash-lite',userDaily:3,globalDaily:10});
  if(route==='jobs'&&method==='GET')return jobs(req);
  if(route==='auth/session'&&method==='GET'){if(!configured())return json({user:null});try{const u=await user();return json({user:{id:u.user.id,email:u.user.email}});}catch(e){if(e instanceof AppError&&e.status===401)return json({user:null});throw e;}}
  if(route==='auth/signup'&&process.env.EMAIL_SIGNUP_ENABLED!=='true')throw new AppError(503,'Use GitHub sign-in to create your private workspace. Email signup is not enabled.');
  if((route==='auth/signin'||route==='auth/signup')&&method==='POST'){
   const input=z.object({email:z.email().max(254),password:z.string().min(10).max(128)}).parse(await body(req));
   const result=route==='auth/signin'?await db().auth.signInWithPassword(input):await db().auth.signUp(input);
   if(result.error)throw new AppError(400,route==='auth/signin'?'Sign-in failed. Check your email/password and email confirmation.':'Sign-up could not finish. Your email may already be registered, or the email service may be unavailable. Try signing in or contact the site owner.');
   if(result.data.session)await setSession(result.data.session);
   return json({message:result.data.session?'Signed in.':'Check your email to confirm your account before signing in.',user:result.data.session?{id:result.data.user?.id,email:result.data.user?.email}:null});
  }
  if(route==='auth/signout'&&method==='POST'){try{const {client}=await user();await client.auth.signOut({scope:'local'});}finally{await clearSession();}return json({ok:true});}
  if(route==='extract'&&method==='POST'){
   await quota(subject(req),'extract');const form=await req.formData();const file=form.get('file');if(!(file instanceof File))throw new AppError(400,'Choose a PDF or DOCX.');
   if(file.size>3*1024*1024)throw new AppError(413,'Upload must be 3 MB or smaller.');
   try{return json({text:await extractFile(file.name,Buffer.from(await file.arrayBuffer()))});}catch(e){throw new AppError(422,e instanceof DocumentInputError?e.message:'This document could not be read. Try another file or enter your background manually.');}
  }
  if(route==='export'&&method==='POST'){
   const input=z.object({text:z.string().min(1).max(30000),format:z.enum(['pdf','docx']),kind:z.enum(['resume','cover-letter'])}).parse(await body(req));await quota(subject(req),'export');
   let bytes:Buffer;try{bytes=input.format==='docx'?await exportDocx(input.text,input.kind):await exportPdf(input.text,input.kind);}catch{throw new AppError(422,'PDF export could not preserve a character in this document. Download DOCX to keep all your text, or replace unsupported characters.');}
   return new NextResponse(new Uint8Array(bytes),{headers:{'Content-Type':input.format==='pdf'?'application/pdf':'application/vnd.openxmlformats-officedocument.wordprocessingml.document','Content-Disposition':`attachment; filename="rolecraft-${input.kind}.${input.format}"`,'Cache-Control':'no-store'}});
  }
  const {client,user:owner}=await user();
  if(route==='profile'){
   if(method==='GET'){const {data,error}=await client.from('profiles').select('data').eq('user_id',owner.id).maybeSingle();storageError(error);return json({profile:data?.data||null});}
   if(method==='PUT'){const data=profileSchema.parse(await body(req));const {error}=await client.from('profiles').upsert({user_id:owner.id,data,updated_at:new Date().toISOString()});storageError(error);return json({ok:true});}
  }
  if(route==='applications'&&method==='GET'){const {data,error}=await client.from('applications').select('*').order('updated_at',{ascending:false});storageError(error);return json({applications:data});}
  if(route==='applications'&&method==='POST'){const input=applicationSchema.parse(await body(req));const {data,error}=await client.from('applications').insert({...input,user_id:owner.id}).select().single();storageError(error);return json({application:data});}
  if(segments[0]==='applications'&&segments[1]){const id=z.uuid().parse(segments[1]);if(method==='PUT'){const input=applicationSchema.parse(await body(req));const {data,error}=await client.from('applications').update({...input,updated_at:new Date().toISOString()}).eq('id',id).eq('user_id',owner.id).select().maybeSingle();storageError(error);if(!data)throw new AppError(404,'Application not found.');return json({application:data});}if(method==='DELETE'){const {error}=await client.from('applications').delete().eq('id',id).eq('user_id',owner.id);storageError(error);return json({ok:true});}}
  if(route==='documents'&&method==='GET'){const {data,error}=await client.from('documents').select('*').order('created_at',{ascending:false});storageError(error);return json({documents:data});}
  if(route==='documents'&&method==='POST'){const input=documentSchema.parse(await body(req));const {data,error}=await client.from('documents').insert({...input,user_id:owner.id}).select().single();storageError(error);return json({document:data});}
  if(segments[0]==='documents'&&segments[1]&&method==='DELETE'){const {error}=await client.rpc('delete_document',{version_id:z.uuid().parse(segments[1])});storageError(error);return json({ok:true});}
  if(route==='data'&&method==='DELETE'){const {error}=await client.rpc('delete_my_data');storageError(error);return json({ok:true});}
  if(route==='generate'&&method==='POST'){
   const schema=z.object({requirements:z.array(z.enum(SKILLS)).max(30),evidence:z.array(z.object({id:z.number().int().min(0).max(39),tags:z.array(z.enum(SKILLS)).max(30)}).strict()).min(1).max(40),adult:z.literal(true),consent:z.literal(true)}).strict();
   const payload=schema.parse(await body(req));
   const country=process.env.VERCEL?req.headers.get('x-vercel-ip-country'):process.env.LOCAL_AI_COUNTRY;
   if(country!=='IN')throw new AppError(403,'Free AI is currently available only to adults in India. Manual matching, editing, exports and tracking remain available.');
   if(!process.env.GEMINI_API_KEY||process.env.GEMINI_FREE_TIER_CONFIRMED!=='true')throw new AppError(503,'Live AI is not configured yet. Use a factual draft without AI.');
   if(!payload.requirements.length)throw new AppError(422,'No supported skill tags were identified in this job. Add more detail or use the manual draft.');
   await quota(owner.id,'ai');
   const response=await fetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent',{method:'POST',headers:{'Content-Type':'application/json','x-goog-api-key':process.env.GEMINI_API_KEY},body:JSON.stringify({systemInstruction:{parts:[{text:'Rank the supplied evidence IDs by relevance to the requirement skill tags. Return JSON {"order":[integer IDs]}. Include every evidence ID exactly once. Do not generate biography or any text. IDs have no meaning outside this request.'}]},contents:[{role:'user',parts:[{text:JSON.stringify({requirements:payload.requirements,evidence:payload.evidence})}]}],generationConfig:{temperature:0,responseMimeType:'application/json',maxOutputTokens:512}}),signal:AbortSignal.timeout(25000)});
   if(response.status===429)throw new AppError(429,'Google’s free quota is exhausted. No paid fallback was used. Edit a manual draft or try later. This attempt counts toward the app limit.');
   if(!response.ok)throw new AppError(502,'AI provider unavailable. No draft was changed. Try later or create a manual draft.');
   const result=await response.json();let order:number[];try{const output=JSON.parse(result.candidates?.[0]?.content?.parts?.map((p:{text?:string})=>p.text||'').join('')||'');order=z.array(z.number().int()).parse(output.order);const supplied=payload.evidence.map(e=>e.id);if(order.length!==supplied.length||new Set(order).size!==order.length||order.some(i=>!supplied.includes(i)))throw new Error();}catch{throw new AppError(502,'AI returned an invalid result. No facts or drafts were changed.');}
   return json({order,model:'gemini-2.5-flash-lite'});
  }
  return json({error:'Not found.'},404);
 }catch(error){if(error instanceof AppError)return json({error:error.message},error.status);if(error instanceof z.ZodError||error instanceof SyntaxError)return json({error:'Check the form fields, supported values and length limits.'},400);return json({error:'The request could not finish. Please try again. Your editor has not been cleared.'},500);}
}
export {handle as GET,handle as POST,handle as PUT,handle as DELETE};
