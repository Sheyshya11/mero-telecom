const fs=require('node:fs');
const cp=require('node:child_process');
const dotenv=require('../../../apps/api/node_modules/dotenv');
const root='D:/MeroTelecom';
const api=root+'/apps/api';
const web=root+'/apps/web';
const env={...process.env,...dotenv.parse(fs.readFileSync(root+'/.env')),...dotenv.parse(fs.readFileSync(root+'/.env.local'))};
Object.assign(env,{NODE_ENV:'development',DATABASE_URL:'postgresql://mero_telecom:mero_telecom_test_password@localhost:5433/capstone_evidence_20261006',REDIS_URL:'redis://localhost:6380/9',PORT:'3001',FRONTEND_URL:'http://localhost:3000',NEXT_PUBLIC_API_URL:'http://localhost:3001/api/v1',EMAIL_DELIVERY_MODE:'redirect',EMAIL_DEV_RECIPIENT:'capstone@example.com',SMTP_HOST:'localhost',SMTP_PORT:'1025',SMTP_SECURE:'false',SMTP_USER:'',SMTP_PASS:'',NBN_PROVIDER:'mock',RELOCATION_PROVIDER:'mock',RELOCATION_RECONCILIATION_INTERVAL_MS:'3600000',CANCELLATION_RECONCILIATION_INTERVAL_MS:'3600000',OVERDUE_LIFECYCLE_INTERVAL_MS:'86400000',S3_ENDPOINT:'',S3_BUCKET:'',S3_ACCESS_KEY_ID:'',S3_SECRET_ACCESS_KEY:''});
const stripeShim='C:/nvm4w/nodejs/node_modules/@stripe/cli/bin/shim.js';
const children=[];
function start(name,args,cwd,extra={}){
 const output=fs.openSync(__dirname+'/'+name+'-runtime.log','a');
 const child=cp.spawn(process.execPath,args,{cwd,env:{...env,...extra},stdio:['ignore',output,output],windowsHide:true});
 children.push(child);console.log(name+' started (PID '+child.pid+').');
 child.on('exit',code=>console.log(name+' exited: '+code));
 return child;
}
try{
 const out=cp.execFileSync(process.execPath,[stripeShim,'listen','--print-secret'],{env:{...env,STRIPE_API_KEY:env.STRIPE_SECRET_KEY},timeout:25000,encoding:'utf8',windowsHide:true,stdio:['ignore','pipe','pipe']});
 const match=out.match(/whsec_[A-Za-z0-9]+/);
 if(!match)throw Error('No webhook signing secret');
 env.STRIPE_WEBHOOK_SECRET=match[0];
 if(!process.argv.includes('--api-only'))start('stripe',[stripeShim,'listen','--forward-to','http://localhost:3001/api/v1/payments/stripe/webhook'],root,{STRIPE_API_KEY:env.STRIPE_SECRET_KEY});
 console.log('Stripe TEST webhook forwarding configured.');
}catch(e){console.log('Stripe webhook setup unavailable: '+e.message.replace(/(?:sk|rk|whsec)_[A-Za-z0-9_]+/g,'[REDACTED]'));}
start('api',['dist/main.js'],api);
if(!process.argv.includes('--api-only'))start('web',[web+'/node_modules/next/dist/bin/next','dev','--port','3000'],web,{PORT:'3000'});
fs.writeFileSync(__dirname+'/runtime-pids.json',JSON.stringify(children.map(c=>c.pid)));
process.on('SIGINT',()=>{for(const child of children)child.kill();process.exit();});
setInterval(()=>{},1000);



