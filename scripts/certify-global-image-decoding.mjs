import { chromium } from "playwright";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
const root=resolve(import.meta.dirname,"..");const dataRoot=resolve(root,"src/modules/setup-wizard/data");
const env=Object.fromEntries(readFileSync(resolve(root,".env.local"),"utf8").split(/\r?\n/).filter((line)=>/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)).map((line)=>{const i=line.indexOf("=");return[line.slice(0,i),line.slice(i+1)]}));
const items=readdirSync(dataRoot).filter((name)=>/^master.*ImageLibrary\.v1\.json$/.test(name)).flatMap((name)=>JSON.parse(readFileSync(resolve(dataRoot,name),"utf8")).images).flatMap((entry)=>(entry.responsive_variants??[entry]).map((variant)=>({url:variant.public_url??`${env.VITE_SUPABASE_URL}/storage/v1/object/public/smart-menu-images/${variant.storage_path}`,width:variant.width,path:variant.storage_path})));
const browser=await chromium.launch({headless:true});const page=await browser.newPage();const failures=[];
for(const item of items){const result=await page.evaluate(async(item)=>{try{const image=new Image();image.src=item.url;await image.decode();return{width:image.naturalWidth,height:image.naturalHeight}}catch(error){return{error:String(error)}}},item);if("error" in result||result.width!==item.width||result.height!==item.width)failures.push({path:item.path,result});}
await browser.close();console.log(JSON.stringify({total:items.length,passed:items.length-failures.length,failed:failures.length,failures:failures.slice(0,20)},null,2));
