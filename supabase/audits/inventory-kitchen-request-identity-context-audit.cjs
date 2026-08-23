const fs=require("fs");
const path=require("path");
const crypto=require("crypto");
const{Client}=require("pg");

const root=path.join(__dirname,"..","..");
const env=Object.fromEntries(fs.readFileSync(path.join(root,"supabase","connection.env"),"utf8").split(/\r?\n/).filter((line)=>line.includes("=")).map((line)=>{const index=line.indexOf("=");return[line.slice(0,index).trim(),line.slice(index+1).trim().replace(/^["']|["']$/g,"")];}));
const migration=fs.readFileSync(path.join(root,"supabase","migrations","250_inventory_kitchen_request_identity_context.sql"),"utf8");
const id=()=>crypto.randomUUID();
const results=[];
const check=(label,ok,detail="")=>{results.push(Boolean(ok));console.log(`${ok?"PASS":"FAIL"} ${label}${detail?` - ${detail}`:""}`);};

async function main(){
  const db=new Client({connectionString:env.SUPABASE_DB_URL,ssl:{rejectUnauthorized:false}});
  await db.connect();
  const asUser=async(userId,sql,params=[])=>{await db.query("set local role authenticated");await db.query("select set_config('request.jwt.claim.sub',$1,true)",[userId]);const output=await db.query(sql,params);await db.query("reset role");return output;};
  const reject=async(label,userId,sql,params,pattern)=>{await db.query("savepoint expected");try{await asUser(userId,sql,params);await db.query("rollback to savepoint expected");check(label,false,"unexpected success");}catch(error){await db.query("rollback to savepoint expected");await db.query("reset role");check(label,pattern.test(error.message),error.message);}};
  try{
    await db.query("begin");
    if(process.env.AUDIT_APPLY_MIGRATION!=="false")await db.query(migration);
    const users=(await db.query("select distinct user_id from public.restaurant_staff where user_id is not null limit 5")).rows.map((row)=>row.user_id);
    if(users.length<5)throw new Error("Hosted audit requires five authenticated identities.");
    const restaurantA=id(),restaurantB=id(),stationA=id(),stationB=id();
    const inventoryA={id:id(),user:users[0]},managerA={id:id(),user:users[1]},chefA={id:id(),user:users[2]},waiterA={id:id(),user:users[3]},inventoryB={id:id(),user:users[4]};
    const requestA=id(),requestLegacy=id(),requestB=id(),suffix=crypto.randomUUID().slice(0,8);
    await db.query("insert into public.restaurants(id,name,slug) values($1,'Identity Audit A',$2),($3,'Identity Audit B',$4)",[restaurantA,`identity-a-${suffix}`,restaurantB,`identity-b-${suffix}`]);
    await db.query(`insert into public.restaurant_staff(id,restaurant_id,user_id,role,display_name,active) values
      ($1,$2,$3,'inventory_officer','Inventory A',true),($4,$2,$5,'manager','Manager A',true),
      ($6,$2,$7,'kitchen','Chef Kumsi',true),($8,$2,$9,'waiter','Waiter A',true),
      ($10,$11,$12,'inventory_officer','Inventory B',true)`,[inventoryA.id,restaurantA,inventoryA.user,managerA.id,managerA.user,chefA.id,chefA.user,waiterA.id,waiterA.user,inventoryB.id,restaurantB,inventoryB.user]);
    await db.query("insert into public.kitchen_stations(id,restaurant_id,name) values($1,$2,'Beverages'),($3,$4,'Other Kitchen')",[stationA,restaurantA,stationB,restaurantB]);
    await db.query(`insert into public.kitchen_inventory_requests(id,restaurant_id,request_type,station_id,requested_by_staff_id,item_name,quantity,unit,urgency,status)
      values($1,$2,'other',$3,$4,'Metal tray',2,'piece','normal','delivered'),
      ($5,$2,'other',null,$4,'Legacy gloves',1,'box','normal','unable_to_fulfill'),
      ($6,$7,'other',$8,$9,'Tenant B tray',1,'piece','normal','delivered')`,[requestA,restaurantA,stationA,chefA.id,requestLegacy,requestB,restaurantB,stationB,inventoryB.id]);

    const inventoryRows=(await asUser(inventoryA.user,"select * from public.get_inventory_kitchen_request_context($1)",[restaurantA])).rows;
    check("Inventory sees same-tenant request context",inventoryRows.length===2);
    check("Station name resolves from canonical request",inventoryRows.find((row)=>row.request_id===requestA)?.station_name==="Beverages");
    check("Chef display name resolves",inventoryRows.find((row)=>row.request_id===requestA)?.requested_by_name==="Chef Kumsi");
    check("Missing historical station stays null",inventoryRows.find((row)=>row.request_id===requestLegacy)?.station_name===null);
    check("Requester name still resolves when station is missing",inventoryRows.find((row)=>row.request_id===requestLegacy)?.requested_by_name==="Chef Kumsi");
    const managerRows=(await asUser(managerA.user,"select * from public.get_inventory_kitchen_request_context($1)",[restaurantA])).rows;
    check("Manager receives same authoritative names",managerRows.some((row)=>row.request_id===requestA&&row.station_name==="Beverages"&&row.requested_by_name==="Chef Kumsi"));
    await reject("Tenant A Inventory cannot request Tenant B context",inventoryA.user,"select * from public.get_inventory_kitchen_request_context($1)",[restaurantB],/access denied/i);
    await reject("Waiter cannot read identity context",waiterA.user,"select * from public.get_inventory_kitchen_request_context($1)",[restaurantA],/access denied/i);
    await db.query("savepoint anon");
    try{await db.query("set local role anon");await db.query("select * from public.get_inventory_kitchen_request_context($1)",[restaurantA]);await db.query("rollback to savepoint anon");check("Anonymous denied",false,"unexpected success");}catch(error){await db.query("rollback to savepoint anon");await db.query("reset role");check("Anonymous denied",/permission denied/i.test(error.message),error.message);}
    const tenantBRows=(await asUser(inventoryB.user,"select * from public.get_inventory_kitchen_request_context($1)",[restaurantB])).rows;
    check("Tenant B sees only Tenant B context",tenantBRows.length===1&&tenantBRows[0].request_id===requestB);
    await db.query("rollback");
  }catch(error){try{await db.query("rollback");}catch{}throw error;}finally{await db.end();}
  const passed=results.filter(Boolean).length;
  console.log(`RESULT ${passed}/${results.length} PASS`);
  if(passed!==results.length)process.exitCode=1;
}
main().catch((error)=>{console.error(`AUDIT ERROR ${error.message}`);process.exitCode=1;});
