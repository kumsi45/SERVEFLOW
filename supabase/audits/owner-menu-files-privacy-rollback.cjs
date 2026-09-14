// Server-side rollback batch: no commit, HTTP writes or real file changes.
const fs=require('node:fs'), crypto=require('node:crypto'), assert=require('node:assert/strict');
const {Client}=require('pg');
const migration=fs.readFileSync('supabase/migrations/262_owner_menu_files_private.sql','utf8');
const line=fs.readFileSync('supabase/connection.env','utf8').split(/\r?\n/).find(x=>x.startsWith('SUPABASE_DB_URL='));
if(!line) throw new Error('Database connection unavailable');
const connectionString=line.slice(line.indexOf('=')+1).trim().replace(/^['"]|['"]$/g,'');
const ids=Object.fromEntries(['a','b','ownerA','ownerB','manager','kitchen','cashier','waiter','inactive','category','item'].map(k=>[k,crypto.randomUUID()]));
const slug=`privacy-rollback-${ids.a}`, path=`${ids.a}/source.pdf`;
const q=x=>`'${String(x).replace(/'/g,"''")}'`;
const checks=[];
const check=(label,user,sql,expected=0,mode='rows')=>checks.push({label,user:user||'',sql,expected,mode});
const objectWhere=`bucket_id='menu-files' and name=${q(path)}`;
check('Owner A lists legacy metadata',ids.ownerA,`select * from public.menu_uploads where restaurant_id=${q(ids.a)}`,1);
check('Owner A reads own file by stable path',ids.ownerA,`select * from storage.objects where ${objectWhere}`,1);
check('Owner A uploads own path',ids.ownerA,`insert into storage.objects(bucket_id,name) values('menu-files',${q(`${ids.a}/new.pdf`)}) returning id`,1);
check('Owner B uploads B path',ids.ownerB,`insert into storage.objects(bucket_id,name) values('menu-files',${q(`${ids.b}/new.pdf`)}) returning id`,1);
check('Owner A updates own object',ids.ownerA,`update storage.objects set metadata='{}' where ${objectWhere} returning id`,1);
check('Owner A deletes own object in API context',ids.ownerA,`delete from storage.objects where ${objectWhere} returning id`,1);
check('Owner A deletes own metadata',ids.ownerA,`delete from public.menu_uploads where restaurant_id=${q(ids.a)} returning id`,1);
for(const key of ['ownerB','manager','kitchen','cashier','waiter','inactive']) {
 check(`${key} cannot read A object`,ids[key],`select * from storage.objects where ${objectWhere}`);
 check(`${key} cannot read A metadata`,ids[key],`select * from public.menu_uploads where restaurant_id=${q(ids.a)}`);
 check(`${key} cannot delete A object`,ids[key],`delete from storage.objects where ${objectWhere} returning id`);
 if(key!=='ownerB') check(`${key} cannot upload source files`,ids[key],`insert into storage.objects(bucket_id,name) values('menu-files',${q(`${ids.a}/${key}.pdf`)})`,0,'denied');
}
check('Owner B cannot update A object',ids.ownerB,`update storage.objects set metadata='{}' where ${objectWhere} returning id`);
check('Owner B cannot upload forged A folder',ids.ownerB,`insert into storage.objects(bucket_id,name) values('menu-files',${q(`${ids.a}/forged.pdf`)})`,0,'denied');
check('Owner A cannot move object to B folder',ids.ownerA,`update storage.objects set name=${q(`${ids.b}/moved.pdf`)} where ${objectWhere}`,0,'denied');
check('Forged metadata tenant denied',ids.ownerB,`insert into public.menu_uploads(restaurant_id,uploaded_by,file_name,file_path,file_url,mime_type,size_bytes) values(${q(ids.a)},${q(ids.ownerB)},'forged.pdf',${q(`${ids.a}/forged.pdf`)},'unused','application/pdf',10)`,0,'denied');
check('Malformed folder denied',ids.ownerA,"insert into storage.objects(bucket_id,name) values('menu-files','not-a-tenant/file.pdf')",0,'denied');
check('Anonymous file listing denied',null,"select * from storage.objects where bucket_id='menu-files'");
check('Anonymous direct object lookup denied',null,`select * from storage.objects where ${objectWhere}`);
check('Anonymous metadata denied',null,`select * from public.menu_uploads where restaurant_id=${q(ids.a)}`);
check('Anonymous photo access preserved',null,`select * from storage.objects where bucket_id='menu-photos' and name=${q(`${ids.a}/photo.png`)}`,1);
check('Public menu: prices, images, availability, no management/QR secrets',null,`select public.get_public_qr_menu(${q(slug)})`,0,'menu');
// Reuse canonically provisioned temporary QR, never rotate even fixture tokens.
check('Public QR browsing leaves no dining session',null,`select public.get_public_qr_order_session(${q(slug)},'1',(select qr_token::text from privacy_fixture_table),${q(crypto.randomUUID())})`,0,'session');
check('Public scan validates without occupying table',null,`select public.log_public_qr_scan(${q(slug)},'1',(select qr_token::text from privacy_fixture_table))`,1);

// Return compact hashes, not real metadata/URLs or large function bodies.
const snapshotSql=`
select md5(coalesce(string_agg(to_jsonb(b)::text,'' order by id),'')) state from storage.buckets b where id in ('menu-files','menu-photos');
select md5(coalesce(string_agg(to_jsonb(p)::text,'' order by schemaname,tablename,policyname),'')) state from pg_policies p where schemaname='storage' or (schemaname='public' and tablename='menu_uploads');
select md5(coalesce(string_agg(jsonb_build_object('oid',c.oid,'acl',c.relacl)::text,'' order by c.oid),'')) state from pg_class c where c.oid in ('storage.objects'::regclass,'storage.buckets'::regclass);
select md5(coalesce(string_agg(jsonb_build_object('oid',p.oid,'acl',p.proacl,'definition',pg_get_functiondef(p.oid))::text,'' order by p.oid),'')) state from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.prokind='f' and (p.proname like 'get_public_qr%' or p.proname='log_public_qr_scan');
select md5(coalesce(string_agg(to_jsonb(u)::text,'' order by id),'')) state from public.menu_uploads u;
select md5(coalesce(string_agg(to_jsonb(o)::text,'' order by id),'')) state from storage.objects o where bucket_id in ('menu-files','menu-photos');`;
const digest=r=>crypto.createHash('sha256').update(JSON.stringify(r.map(x=>x.rows[0].state))).digest('hex');
let seed='';
for(const key of ['ownerA','ownerB','manager','kitchen','cashier','waiter','inactive']) seed+=`insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at) values(${q(ids[key])},'00000000-0000-0000-0000-000000000000','authenticated','authenticated',${q(`${ids[key]}@privacy-rollback.invalid`)},'',now(),now(),now());\n`;
for(const key of ['a','b']) seed+=`insert into public.restaurants(id,name,slug,total_tables,table_count) values(${q(ids[key])},'Privacy rollback fixture',${q(key==='a'?slug:`${slug}-b`)},1,1);\n`;
for(const [key,role,tenant] of [['ownerA','owner','a'],['ownerB','owner','b'],['manager','manager','a'],['kitchen','kitchen','a'],['cashier','cashier','a'],['waiter','waiter','a'],['inactive','owner','a']]) seed+=`insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,email,active) values(${q(crypto.randomUUID())},${q(ids[tenant])},${q(ids[key])},${q(role)},${q(key)},${q(`${ids[key]}@privacy-rollback.invalid`)},${key!=='inactive'});\n`;
seed+=`insert into storage.objects(bucket_id,name) values('menu-files',${q(path)}),('menu-photos',${q(`${ids.a}/photo.png`)});
insert into public.menu_uploads(restaurant_id,uploaded_by,file_name,file_path,file_url,mime_type,size_bytes) values(${q(ids.a)},${q(ids.ownerA)},'source.pdf',${q(path)},${q(`https://example.invalid/storage/v1/object/public/menu-files/${path}`)},'application/pdf',20);
insert into public.categories(id,restaurant_id,name) values(${q(ids.category)},${q(ids.a)},'Menu');
insert into public.menu_items(id,restaurant_id,category_id,name,price,image_url) values(${q(ids.item)},${q(ids.a)},${q(ids.category)},'Available fixture',12.50,'https://example.invalid/photo.png');
insert into public.menu_items(restaurant_id,category_id,name,price,available,archived_at) values(${q(ids.a)},${q(ids.category)},'Unavailable fixture',2,false,null),(${q(ids.a)},${q(ids.category)},'Archived fixture',3,true,now());
create temp table privacy_fixture_table on commit drop as select qr_token from public.restaurant_tables where restaurant_id=${q(ids.a)} and table_number=1;
grant select on privacy_fixture_table to anon,authenticated;`;
const validationSql=`begin;
set local lock_timeout='5s'; set local statement_timeout='30s';
${migration}
${migration}
${seed}
do $privacy_validation$
declare probe jsonb; n bigint; payload jsonb;
begin
 if (select public from storage.buckets where id='menu-files') is distinct from false then raise exception 'Source bucket not private'; end if;
 if (select public from storage.buckets where id='menu-photos') is distinct from true then raise exception 'Photo bucket changed'; end if;
 if (select count(*) from privacy_fixture_table)<>1 then raise exception 'Canonical temporary table missing'; end if;
 for probe in select value from jsonb_array_elements(${q(JSON.stringify(checks))}::jsonb) loop
  begin
   execute 'set local role '||case when probe->>'user'='' then 'anon' else 'authenticated' end;
   perform set_config('request.jwt.claim.sub',probe->>'user',true);
   perform set_config('request.jwt.claim.role',case when probe->>'user'='' then 'anon' else 'authenticated' end,true);
   -- Match Storage API context, do not disable RLS or deletion triggers.
   perform set_config('storage.allow_delete_query','true',true);
   if probe->>'mode' in ('menu','session') then
    execute probe->>'sql' into payload;
    if probe->>'mode'='session' and payload is not null then raise exception 'Unexpected session: %',probe->>'label'; end if;
    if probe->>'mode'='menu' then
     if jsonb_array_length(payload->'items')<>1 or (payload->'items'->0->>'price')::numeric<>12.50 or payload->'items'->0->>'image_url' is null then raise exception 'Public menu changed'; end if;
     if payload::text ~ 'qr_token|qr_path|qr_url|menu-files|source.pdf|file_url' then raise exception 'Public management/capability leak'; end if;
    end if;
   else
    execute probe->>'sql'; get diagnostics n=row_count;
    if probe->>'mode'='denied' then raise exception 'Expected RLS rejection: %',probe->>'label'; end if;
    if n<>(probe->>'expected')::bigint then raise exception 'Unexpected row count for %: %',probe->>'label',n; end if;
   end if;
   -- Subtransaction rolls back every successful mutation/scan as well.
   raise exception using errcode='ZX001',message='successful rollback probe';
  exception
   when sqlstate 'ZX001' then null;
   when insufficient_privilege then if probe->>'mode'<>'denied' then raise; end if;
  end;
 end loop;
 if exists(select 1 from public.orders where restaurant_id=${q(ids.a)}) then raise exception 'Browsing/scanning occupied a table'; end if;
end;
$privacy_validation$;
rollback;`;
async function main(){
 const c=new Client({connectionString,ssl:{rejectUnauthorized:false},application_name:'serveflow-menu-privacy-rollback',connectionTimeoutMillis:10000,query_timeout:30000});c.on('error',()=>{});await c.connect();
 try{
  console.log('Connected; reading rollback baseline');
  const before=digest(await c.query(snapshotSql));
  console.log('Baseline read; running server-side validation');
  await c.query(validationSql);
  console.log('Validation rolled back; checking restored baseline');
  assert.equal(digest(await c.query(snapshotSql)),before,'Hosted baseline must be restored');
  const residue=(await c.query("select (select count(*) from public.restaurants where slug like 'privacy-rollback-%')+(select count(*) from auth.users where email like '%@privacy-rollback.invalid') n")).rows[0].n;
  assert.equal(Number(residue),0,'Zero fixture residue, including earlier failed attempts');
  console.log(JSON.stringify({passed:checks.length+3,checks:checks.map(x=>x.label),idempotent:true,baselineRestored:true,fixtureResidue:0,scope:'SQL/RLS authority; uncommitted schema not visible to Storage HTTP connections'},null,2));
 }finally{await c.query('rollback').catch(()=>{});await c.end();}
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
