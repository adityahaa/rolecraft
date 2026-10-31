import 'server-only';
import { createClient } from '@supabase/supabase-js';
import { cookies } from 'next/headers';
export class AppError extends Error {constructor(public status:number,message:string){super(message);}}
export function configured(){return !!(process.env.SUPABASE_URL&&process.env.SUPABASE_ANON_KEY&&process.env.SUPABASE_SERVICE_ROLE_KEY);}
export function db(access?:string,admin=false){
 if(!configured())throw new AppError(503,'Online sync is not configured yet. You can explore the example and edit drafts without signing in.');
 return createClient(process.env.SUPABASE_URL!,admin?process.env.SUPABASE_SERVICE_ROLE_KEY!:process.env.SUPABASE_ANON_KEY!,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:access?{headers:{Authorization:`Bearer ${access}`}}:undefined});
}
export async function setSession(session:{access_token:string;refresh_token:string;expires_in:number}){
 const jar=await cookies();const options={httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax' as const,path:'/'};
 jar.set('rc-access',session.access_token,{...options,maxAge:session.expires_in});jar.set('rc-refresh',session.refresh_token,{...options,maxAge:60*60*24*14});
}
export async function clearSession(){const jar=await cookies();jar.delete('rc-access');jar.delete('rc-refresh');}
// Persist only short-lived PKCE proof cookies, never GitHub provider tokens.
export async function oauthClient(){
 if(!configured())throw new AppError(503,'Account setup is not configured yet.');
 const jar=await cookies();
 const allowed=(key:string)=>key.startsWith('rc-oauth-')&&key.endsWith('-code-verifier');
 return createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_ANON_KEY!,{auth:{flowType:'pkce',storageKey:'rc-oauth',persistSession:true,autoRefreshToken:false,detectSessionInUrl:false,storage:{
  getItem:key=>allowed(key)?jar.get(key)?.value??null:null,
  setItem:(key,value)=>{if(allowed(key)&&value.length<3500)jar.set(key,value,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge:600});},
  removeItem:key=>{if(allowed(key))jar.delete(key);}
 }}});
}
export async function user(){
 const jar=await cookies();let token=jar.get('rc-access')?.value;let client=db(token);
 if(token){const {data,error}=await client.auth.getUser(token);if(!error&&data.user)return {client,user:data.user};}
 const refresh=jar.get('rc-refresh')?.value;if(refresh){const {data,error}=await db().auth.refreshSession({refresh_token:refresh});if(!error&&data.session&&data.user){await setSession(data.session);token=data.session.access_token;client=db(token);return {client,user:data.user};}}
 throw new AppError(401,'Please sign in to use private sync or live AI.');
}
export async function quota(subject:string,kind:'ai'|'extract'|'export'){
 if(!configured()){if(kind==='ai')throw new AppError(503,'Live AI is not configured yet.');if(process.env.VERCEL)throw new AppError(503,'Document processing is waiting for database setup. The example and editor remain available.');return;}
 const {data,error}=await db(undefined,true).rpc('claim_usage',{subject_key:subject,usage_kind:kind});
 if(error)throw new AppError(503,'Usage checks are temporarily unavailable. Please try again later.');
 if(!data)throw new AppError(429,kind==='ai'?'AI limit reached. Wait at least one minute; daily limits reset at 00:00 UTC. You can still edit and export.':'Document processing limit reached. Please try again in an hour.');
}
export function storageError(error:unknown){if(error)throw new AppError(503,'Could not save or load data. Check your connection and saved-item limit (100 applications and 100 versions), then retry. Your editor has not been cleared.');}
