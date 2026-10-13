async (page) => {
 const response=await page.request.post('http://localhost:3001/api/v1/auth/login',{headers:{Origin:'http://localhost:3000'},data:{email:'admin@merotelecom.test',password:'ChangeMe123!'}});
 if(!response.ok())throw Error('Demo login returned '+response.status());
 await page.goto('http://localhost:3000/control-centre/dashboard');
 await page.getByRole('heading',{level:1}).waitFor();
 return {role:'admin',url:page.url(),heading:await page.getByRole('heading',{level:1}).innerText()};
}