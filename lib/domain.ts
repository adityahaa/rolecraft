import { z } from 'zod';
export const SKILLS = ['Product strategy','User research','Data analysis','SQL','Excel','Python','JavaScript','TypeScript','React','Figma','Prototyping','Wireframing','A/B testing','Analytics','Roadmapping','Agile','Communication','Stakeholder management','Project management','Market research','Competitive analysis','Writing','Customer support','Design','Marketing','Sales','Operations','Engineering','Leadership','Collaboration'] as const;
export const SECTIONS = ['Experience','Projects','Education','Skills','Certifications'] as const;
export const STATUSES = ['Saved','Applied','Interviewing','Offer','Closed'] as const;
export const factSchema = z.object({id:z.string().uuid(),section:z.enum(SECTIONS),text:z.string().trim().min(1).max(3000),tags:z.array(z.enum(SKILLS)).max(30)});
export const profileSchema = z.object({name:z.string().max(100),contact:z.string().max(500),headline:z.string().max(150),facts:z.array(factSchema).max(40),confirmed:z.boolean()}).refine(p=>JSON.stringify(p).length<=30000,'Profile is too long.');
export type Profile = z.infer<typeof profileSchema>;
export const emptyProfile:Profile = {name:'',contact:'',headline:'',facts:[],confirmed:false};
export const jobSchema = z.object({id:z.string().max(150),company:z.string().trim().min(1).max(150),role:z.string().trim().min(1).max(150),location:z.string().max(150),url:z.string().max(1500).refine(s=>s===''||safeUrl(s)!==null,'Use an HTTPS job link.'),description:z.string().max(20000),arrangement:z.enum(['Remote','Hybrid','On-site','Unknown']),source:z.string().max(80),posted:z.string().nullable(),refreshed:z.string().nullable()});
export type Job=z.infer<typeof jobSchema>;
export const documentSchema=z.object({label:z.string().trim().min(1).max(100),resume:z.string().min(1).max(30000),letter:z.string().max(12000),provenance:z.enum(['AI-assisted','Manual','Example']),job_role:z.string().max(150),job_company:z.string().max(150)});
export type Draft=z.infer<typeof documentSchema>;
export const applicationSchema=z.object({company:z.string().trim().min(1).max(150),role:z.string().trim().min(1).max(150),job_url:z.string().max(1500).refine(s=>s===''||safeUrl(s)!==null),status:z.enum(STATUSES),follow_up:z.string().nullable().refine(s=>!s||/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))),notes:z.string().max(5000),document_id:z.string().uuid().nullable()});
export type Application=z.infer<typeof applicationSchema>&{id:string;updated_at?:string};
export type SavedDocument=Draft&{id:string;created_at:string};
export function safeUrl(value:string):string|null {try {const u=new URL(value);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null;}catch{return null;}}
export function tagsFor(text:string):string[] {const t=text.toLowerCase();return SKILLS.filter(s=>new RegExp('(^|[^a-z])'+s.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'([^a-z]|$)').test(t));}
export function match(profile:Profile,job:Job){
 const required=tagsFor(job.description+' '+job.role);const supplied=new Set<string>(profile.facts.flatMap(f=>f.tags));
 const matched=required.filter(t=>supplied.has(t)),gaps=required.filter(t=>!supplied.has(t));
 return {required,matched,gaps,score:required.length?Math.round(matched.length/required.length*100):null,evidence:profile.facts.filter(f=>f.tags.some(t=>required.includes(t)))};
}
export function aiPayload(profile:Profile,job:Job) {return {requirements:tagsFor(job.description+' '+job.role),evidence:profile.facts.map((f,i)=>({id:i,tags:f.tags}))};}
export function compose(profile:Profile,job:Job,order:number[],ai=false):Draft{
 const ids=[...new Set([...order,...profile.facts.map((_,i)=>i)])].filter(i=>Number.isInteger(i)&&i>=0&&i<profile.facts.length);
 const facts=ids.map(i=>profile.facts[i]);const relevant=facts.filter(f=>f.tags.some(t=>tagsFor(job.description+' '+job.role).includes(t))).slice(0,3);
 const resume=[profile.name,profile.headline,profile.contact,...SECTIONS.flatMap(section=>{const rows=facts.filter(f=>f.section===section);return rows.length?['',section.toUpperCase(),...rows.map(r=>r.text)]:[];})].filter((v,i)=>v||i>2).join('\n\n');
 const letter=[`Dear ${job.company} hiring team,`,`I am applying for the ${job.role} position. I would welcome the opportunity to discuss how my background aligns with your team.`,...(relevant.length?['Relevant details from my background:',...relevant.map(f=>f.text)]:['[Add a specific, confirmed example that relates to this role.]']),'Thank you for considering my application. I would be glad to share more about my experience.','Sincerely,',profile.name].join('\n\n');
 return {label:`${job.company} — ${job.role}`,resume,letter,provenance:ai?'AI-assisted':'Manual',job_role:job.role,job_company:job.company};
}
export const exampleProfile:Profile={name:'Alex Morgan',headline:'Product-focused student | Research & analytics',contact:'alex@example.com | Mumbai, India',confirmed:true,facts:[
 {id:'00000000-0000-4000-8000-000000000001',section:'Projects',text:'Campus Compass — Student project\nInterviewed classmates about finding campus events and documented recurring pain points. Created a Figma prototype and presented the concept to the project team.',tags:['User research','Figma','Prototyping','Communication']},
 {id:'00000000-0000-4000-8000-000000000002',section:'Projects',text:'Open-data exploration — Independent project\nUsed Excel and SQL to explore a public transport dataset. Summarized patterns and limitations in a written report.',tags:['Excel','SQL','Data analysis','Writing']},
 {id:'00000000-0000-4000-8000-000000000003',section:'Education',text:'Example University\nBachelor of Management Studies — in progress',tags:[]}
]};
export const exampleJob:Job={id:'example',role:'Product Intern',company:'Example Studio (fictional)',location:'Mumbai, India',url:'',description:'EXAMPLE ONLY — not a real vacancy. Support user research, data analysis, competitive analysis and prototyping. Communicate findings clearly. Experience with SQL and Figma is helpful.',arrangement:'Hybrid',source:'Synthetic example',posted:null,refreshed:null};
