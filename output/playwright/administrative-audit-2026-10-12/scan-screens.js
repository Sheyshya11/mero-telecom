async (page) => {
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
}