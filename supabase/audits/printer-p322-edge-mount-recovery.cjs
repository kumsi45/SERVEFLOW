// Replaces only the disposable P3.2.2 Edge container with a host-resolvable
// Windows bind mount. Never targets hosted resources.
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const fs=require('node:fs');
const path=require('node:path');
const {spawnSync}=require('node:child_process');
function docker(args){const r=spawnSync('docker',args,{encoding:'utf8',timeout:120000,maxBuffer:8*1024*1024});
  if(r.status!==0)throw new Error(`docker ${args[0]} failed: ${r.stderr.slice(-500)}`);return r.stdout.trim()}
const old=JSON.parse(docker(['inspect','supabase_edge_runtime_workspace']))[0];
assert.equal(old.HostConfig.NetworkMode,'supabase_network_workspace');
assert.equal(old.Config.Image,'public.ecr.aws/supabase/edge-runtime:v1.74.1');
assert.equal(old.Config.Entrypoint[0],'sh');
const target='supabase_edge_runtime_p322';
const present=spawnSync('docker',['inspect',target],{encoding:'utf8'});
if(present.status===0)throw new Error('Disposable replacement Edge container already exists');
const env=[...old.Config.Env];
const secret=()=>crypto.randomBytes(32).toString('base64url');
env.push(`PRINT_BRIDGE_DIGEST_KEYS=${JSON.stringify({current:'v1',keys:{v1:secret()}})}`,
  `PRINT_BRIDGE_RATE_KEY=${secret()}`,
  'PRINT_BRIDGE_EMAIL_DOMAIN=bridge.p322.example.test',
  'PRINT_BRIDGE_OWNER_ORIGIN=http://localhost:5173',
  'UPSTASH_REDIS_REST_URL=https://unavailable.p322.example.test',
  `UPSTASH_REDIS_REST_TOKEN=${secret()}`,
  `PRINT_BRIDGE_MAINTENANCE_KEY=${secret()}${secret()}`);
const temp=path.join(process.env.LOCALAPPDATA,'Temp','serveflow-p322-edge-local.env');
fs.writeFileSync(temp,env.join('\n')+'\n',{mode:0o600});
docker(['stop','supabase_edge_runtime_workspace']);
const functions=path.resolve(__dirname,'..','functions');
const args=['run','-d','--name',target,'--network','supabase_network_workspace',
  '--network-alias','supabase_edge_runtime_workspace','--env-file',temp,
  '-v',`${functions}:/workspace/supabase/functions:ro`,
  '-v','supabase_edge_runtime_workspace:/root/.cache/deno','-w','/workspace',
  '--entrypoint','sh',old.Config.Image,'-c',old.Config.Entrypoint[2]];
const container=docker(args);
console.log(`Started isolated Edge replacement ${container.slice(0,12)} with source mount; secrets remain in private temp env file.`);
