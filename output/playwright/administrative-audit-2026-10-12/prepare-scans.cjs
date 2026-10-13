const fs=require('node:fs');
for(const role of ['admin','staff'])fs.writeFileSync(`output/playwright/administrative-audit-2026-10-12/login-${role}.js`,`async (page) => {
 const response=await page.request.post('http://localhost:3001/api/v1/auth/login',{headers:{Origin:'http://localhost:3000'},data:{email:'${role}@merotelecom.test',password:'ChangeMe123!'}});
 if(!response.ok())throw Error('Demo login returned '+response.status());
 await page.goto('http://localhost:3000/control-centre/dashboard');
 await page.getByRole('heading',{level:1}).waitFor();
 return {role:'${role}',url:page.url(),heading:await page.getByRole('heading',{level:1}).innerText()};
}`);
fs.writeFileSync('output/playwright/administrative-audit-2026-10-12/scan-screens.js',`async (page) => {
 const errors=[],networkFailures=[],screens=[];
 page.on('pageerror',e=>errors.push(e.message));
 page.on('response',r=>{if(r.url().includes('/api/v1/')&&r.status()>=400)networkFailures.push({url:r.url(),status:r.status()});});
 const paths=['dashboard','support','internal-requests','customers','services','relocations','cancellations','invoices','billing','refunds','plans','coverage','staff','audit-logs'];
 for(const path of paths){
   const failureStart=networkFailures.length;
   await page.goto('http://localhost:3000/control-centre/'+path);
   await page.waitForLoadState('networkidle').catch(()=>{});
   const main=page.getByRole('main');
   const text=await main.innerText().catch(()=>page.locator('body').innerText());
   screens.push({path,url:page.url(),headings:await main.getByRole('heading').allTextContents(),buttons:await main.getByRole('button').allTextContents(),text,failures:networkFailures.slice(failureStart)});
 }
 return {screens,errors,networkFailures};
}`);
