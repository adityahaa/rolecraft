import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';
export class DocumentInputError extends Error {}
const headings=new Set(['EXPERIENCE','PROJECTS','EDUCATION','SKILLS','CERTIFICATIONS']);
export async function exportDocx(text:string,kind:'resume'|'cover-letter'='resume'){
 const doc=new Document({creator:'Rolecraft',title:'Application document',styles:{default:{document:{run:{font:'Calibri',size:22},paragraph:{spacing:{after:140}}}}},sections:[{properties:{page:{margin:{top:900,bottom:900,left:1000,right:1000}}},children:text.split('\n').map((line,i)=>new Paragraph({heading:i===0&&kind==='resume'?HeadingLevel.TITLE:headings.has(line.trim())?HeadingLevel.HEADING_1:undefined,children:[new TextRun({text:line})]}))}]});return Packer.toBuffer(doc);
}
export async function exportPdf(text:string,kind:'resume'|'cover-letter'='resume'){
 const doc=await PDFDocument.create();doc.registerFontkit(fontkit);const font=await doc.embedFont(await readFile(path.join(process.cwd(),'assets/NotoSans-Regular.ttf')),{subset:true});
 const supported=new Set(font.getCharacterSet());for(const ch of text){if(!/\s/.test(ch)&&!supported.has(ch.codePointAt(0)!))throw new DocumentInputError('This PDF font does not support one or more characters. Use DOCX to preserve your text, or replace those characters.');}
 let page=doc.addPage([595.28,841.89]),y=785;const left=50,width=495;
 function line(value:string,size:number){if(y<65){page=doc.addPage([595.28,841.89]);y=785;}page.drawText(value,{x:left,y,size,font,color:rgb(.12,.16,.2)});y-=size*1.5;}
 text.split('\n').forEach((para,i)=>{const size=i===0&&kind==='resume'?19:headings.has(para.trim())?12:10.5;if(!para.trim()){y-=8;return;}let row='';for(const char of para.replace(/\t/g,'    ')){if(font.widthOfTextAtSize(row+char,size)>width){const last=row.lastIndexOf(' ');if(last>0){line(row.slice(0,last),size);row=row.slice(last+1)+char;}else{line(row,size);row=char;}}else row+=char;}if(row)line(row,size);});
 return Buffer.from(await doc.save());
}
export async function extractFile(name:string,bytes:Buffer){
 if(bytes.length>3*1024*1024||bytes.length<5)throw new DocumentInputError('Upload a readable PDF or DOCX up to 3 MB.');
 let text='';
 if(name.toLowerCase().endsWith('.pdf')){
  if(bytes.subarray(0,5).toString()!=='%PDF-')throw new DocumentInputError('This file is not a valid PDF.');
  const {PDFParse}=await import('pdf-parse');const parser=new PDFParse({data:bytes});
  try {const info=await parser.getInfo();if(info.total>30)throw new DocumentInputError('Please upload a resume with 30 pages or fewer.');text=(await parser.getText()).text;}finally{await parser.destroy();}
 }else if(name.toLowerCase().endsWith('.docx')){
  if(bytes[0]!==0x50||bytes[1]!==0x4b)throw new DocumentInputError('This file is not a valid DOCX.');
  const zip=await JSZip.loadAsync(bytes);const entries=Object.values(zip.files);if(entries.length>500||!zip.file('word/document.xml'))throw new DocumentInputError('This file is not a supported DOCX.');
  // Reject ZIP expansion before Mammoth parses it. Central-directory sizes come from the file.
  let size=0;for(const entry of entries){size+=(entry as unknown as {_data?:{uncompressedSize?:number}})._data?.uncompressedSize??0;}if(size>10*1024*1024)throw new DocumentInputError('The document expands beyond the 10 MB processing limit.');
  const mammoth=await import('mammoth');text=(await mammoth.extractRawText({buffer:bytes})).value;
 }else throw new DocumentInputError('Only .pdf and .docx files are supported.');
 if(text.trim().length<30)throw new DocumentInputError('No usable text was found. This may be a scanned or protected document. Paste your background manually; OCR is not included.');
 if(text.length>30000)throw new DocumentInputError('Extracted text exceeds 30,000 characters. Please upload a shorter document.');
 return text.trim();
}
