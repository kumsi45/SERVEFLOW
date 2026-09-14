// Post-deploy Storage API/HTTP proof. All generated identities and paths are
// scoped to this run and removed in finally; no real restaurant files are read.
const fs = require('node:fs');
const crypto = require('node:crypto');
const { Client } = require('pg');
const { createClient } = require('@supabase/supabase-js');
const { chromium } = require('playwright');

const env = Object.fromEntries(fs.readFileSync('.env.local','utf8').split(/\r?\n/).filter(x=>x.includes('=')&&!x.trim().startsWith('#')).map(x=>{const i=x.indexOf('=');return [x.slice(0,i).trim(),x.slice(i+1).trim().replace(/^['"]|['"]$/g,'')]}));
const dbLine = fs.readFileSync('supabase/connection.env','utf8').split(/\r?\n/).find(x=>x.startsWith('SUPABASE_DB_URL='));
if (!env.VITE_SUPABASE_URL || !env.VITE_SUPABASE_ANON_KEY || !env.SUPABASE_SERVICE_ROLE_KEY || !dbLine) throw new Error('Required local configuration is unavailable');
const url=env.VITE_SUPABASE_URL, anonKey=env.VITE_SUPABASE_ANON_KEY;
const service=createClient(url,env.SUPABASE_SERVICE_ROLE_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const dbUrl=dbLine.slice(dbLine.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
const id=()=>crypto.randomUUID(), randomToken=()=>crypto.randomBytes(12).toString('hex');
const ids={a:id(),b:id(),category:id(),item:id()};
const suffix=randomToken(), slug=`privacy-deploy-${suffix}`, password=`T-${randomToken()}-aA1!`;
const paths={fileA:`${ids.a}/source-${suffix}.pdf`,photoA:`${ids.a}/photo-${suffix}.png`};
const createdUsers=[]; const identities={}; const results=[];
let db;
const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9J1G4AAAAASUVORK5CYII=','base64');
function check(label,value){if(!value) throw new Error(`Failed: ${label}`);results.push(label)}
async function clientFor(key){const email=`menu-private-${suffix}-${key}@example.invalid`;const {data,error}=await service.auth.admin.createUser({email,password,email_confirm:true});if(error||!data.user)throw new Error(error?.message||'Could not create fixture user');createdUsers.push(data.user.id);const publicClient=createClient(url,anonKey,{auth:{autoRefreshToken:false,persistSession:false}});const signIn=await publicClient.auth.signInWithPassword({email,password});if(signIn.error||!signIn.data.session)throw new Error(signIn.error?.message||'Could not authenticate fixture user');return {id:data.user.id,client:publicClient,token:signIn.data.session.access_token}}
async function main(){
 db=new Client({connectionString:dbUrl,ssl:{rejectUnauthorized:false}});await db.connect();
 try{
  for(const key of ['ownerA','ownerB','manager','kitchen','cashier','waiter','inactive']) identities[key]=await clientFor(key);
  await db.query('begin');
  await db.query('insert into public.restaurants(id,name,slug,total_tables,table_count) values($1,$2,$3,1,1),($4,$5,$6,1,1)',[ids.a,'Menu privacy deploy A',slug,ids.b,'Menu privacy deploy B',`${slug}-b`]);
  for(const [key,role,restaurant,active] of [['ownerA','owner',ids.a,true],['ownerB','owner',ids.b,true],['manager','manager',ids.a,true],['kitchen','kitchen',ids.a,true],['cashier','cashier',ids.a,true],['waiter','waiter',ids.a,true],['inactive','owner',ids.a,false]]) await db.query('insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,email,active) values($1,$2,$3,$4,$5,$6,$7)',[id(),restaurant,identities[key].id,role,key,`menu-private-${suffix}-${key}@example.invalid`,active]);
  await db.query('insert into public.categories(id,restaurant_id,name) values($1,$2,$3)',[ids.category,ids.a,'Fixture menu']);
  await db.query('insert into public.menu_items(id,restaurant_id,category_id,name,price,image_url) values($1,$2,$3,$4,12.50,$5)',[ids.item,ids.a,ids.category,'Available fixture',`${url}/storage/v1/object/public/menu-photos/${paths.photoA}`]);
  await db.query('insert into public.menu_items(restaurant_id,category_id,name,price,available,archived_at) values($1,$2,$3,2,false,null),($1,$2,$4,3,true,now())',[ids.a,ids.category,'Unavailable fixture','Archived fixture']);
  await db.query('commit');
  const a=identities.ownerA.client,b=identities.ownerB.client;
  let r=await a.storage.from('menu-files').upload(paths.fileA,new Blob(['private fixture'],{type:'application/pdf'}),{contentType:'application/pdf',upsert:false});check('Owner A uploads own private file',!r.error);
  r=await a.from('menu_uploads').insert({restaurant_id:ids.a,uploaded_by:identities.ownerA.id,file_name:'source.pdf',file_path:paths.fileA,file_url:paths.fileA,mime_type:'application/pdf',size_bytes:15});check('Owner A inserts path-identity metadata',!r.error);
  const ownList=await a.from('menu_uploads').select('file_path,file_url').eq('restaurant_id',ids.a);check('Owner A lists own metadata',!ownList.error&&ownList.data?.length===1&&ownList.data[0].file_path===ownList.data[0].file_url);
  const first=await a.storage.from('menu-files').download(paths.fileA), second=await a.storage.from('menu-files').download(paths.fileA);check('Owner A reopens through authenticated downloads',!first.error&&!second.error&&first.data?.size===15&&second.data?.size===15);
  const oldPublic=`${url}/storage/v1/object/public/menu-files/${paths.fileA}`;
  const anonymousHttp=await fetch(oldPublic);check('Old public URL cannot fetch private file',!anonymousHttp.ok);
  const anonymousClient=createClient(url,anonKey,{auth:{autoRefreshToken:false,persistSession:false}});
  const anonymousDownload=await anonymousClient.storage.from('menu-files').download(paths.fileA), anonymousList=await anonymousClient.storage.from('menu-files').list(ids.a), anonymousMetadata=await anonymousClient.from('menu_uploads').select('*').eq('restaurant_id',ids.a);check('Anonymous Storage/API cannot read file/list/metadata',Boolean(anonymousDownload.error)&&(!anonymousList.data||anonymousList.data.length===0)&&(!anonymousMetadata.data||anonymousMetadata.data.length===0));
  const bDownload=await b.storage.from('menu-files').download(paths.fileA), bList=await b.storage.from('menu-files').list(ids.a), bMeta=await b.from('menu_uploads').select('*').eq('restaurant_id',ids.a), forged=await b.storage.from('menu-files').upload(`${ids.a}/forged-${suffix}.pdf`,new Blob(['x'],{type:'application/pdf'}),{contentType:'application/pdf'});check('Owner B cannot read/list/forge Owner A path or metadata',Boolean(bDownload.error)&&(!bList.data||bList.data.length===0)&&(!bMeta.data||bMeta.data.length===0)&&Boolean(forged.error));
  for(const key of ['manager','kitchen','cashier','waiter','inactive']){const c=identities[key].client;const read=await c.storage.from('menu-files').download(paths.fileA), write=await c.storage.from('menu-files').upload(`${ids.a}/${key}-${suffix}.pdf`,new Blob(['x'],{type:'application/pdf'}),{contentType:'application/pdf'});check(`${key} remains denied`,Boolean(read.error)&&Boolean(write.error));}
  const photo=await a.storage.from('menu-photos').upload(paths.photoA,new Blob([png],{type:'image/png'}),{contentType:'image/png',upsert:false});check('Owner A uploads public menu photo',!photo.error);const publicPhoto=await fetch(`${url}/storage/v1/object/public/menu-photos/${paths.photoA}`);check('Menu photo remains publicly readable',publicPhoto.ok&&(publicPhoto.headers.get('content-type')||'').startsWith('image/'));
  const menu=await anonymousClient.rpc('get_public_qr_menu',{target_restaurant_slug:slug});const menuText=JSON.stringify(menu.data??{});check('Public QR menu keeps available price/image and excludes unavailable/archive/secrets',!menu.error&&menu.data?.items?.length===1&&Number(menu.data.items[0].price)===12.5&&Boolean(menu.data.items[0].image_url)&&!/qr_token|qr_path|qr_url|menu-files|source\.pdf|file_url/.test(menuText));
  const table=(await db.query('select qr_token from public.restaurant_tables where restaurant_id=$1 and table_number=1',[ids.a])).rows[0];check('Temporary canonical table exists',Boolean(table?.qr_token));const browser=await chromium.launch({headless:true});try{const page=await browser.newPage();const browserResult=await page.evaluate(async({base,key,jwt,path})=>{const endpoint=`${base}/storage/v1/object/authenticated/menu-files/${path.split('/').map(encodeURIComponent).join('/')}`;const headers={apikey:key,Authorization:`Bearer ${jwt}`};const first=await fetch(endpoint,{headers});const blob=await first.blob();const objectUrl=URL.createObjectURL(blob);const second=await fetch(endpoint,{headers});URL.revokeObjectURL(objectUrl);return {first:first.ok,size:blob.size,second:second.ok};},{base:url,key:anonKey,jwt:identities.ownerA.token,path:paths.fileA});check('Browser authenticated download and object-URL revoke work',browserResult.first&&browserResult.second&&browserResult.size===15)}finally{await browser.close()}
  const delMeta=await a.from('menu_uploads').delete().eq('restaurant_id',ids.a).eq('file_path',paths.fileA),delFile=await a.storage.from('menu-files').remove([paths.fileA]);check('Owner A deletes own metadata and file',!delMeta.error&&!delFile.error);
 } finally {
  // Exact temporary paths only; service cleanup is a last-resort fixture cleanup.
  await service.storage.from('menu-files').remove([paths.fileA]).catch(()=>{});await service.storage.from('menu-photos').remove([paths.photoA]).catch(()=>{});
  if(db){await db.query('delete from public.restaurants where id=any($1::uuid[])',[ [ids.a,ids.b] ]).catch(()=>{});await db.end().catch(()=>{})}
  for(const userId of createdUsers) await service.auth.admin.deleteUser(userId).catch(()=>{});
 }
 const verify=new Client({connectionString:dbUrl,ssl:{rejectUnauthorized:false}});await verify.connect();const residue=(await verify.query("select (select count(*) from public.restaurants where slug=$1)+(select count(*) from auth.users where email like $2)+(select count(*) from storage.objects where bucket_id in ('menu-files','menu-photos') and name=any($3::text[])) n",[slug,`menu-private-${suffix}-%`,[paths.fileA,paths.photoA]])).rows[0].n;await verify.end();check('Zero fixture residue',Number(residue)===0);
 console.log(JSON.stringify({passed:results.length,results},null,2));
}
main().catch(error=>{console.error(error.message);process.exitCode=1});
