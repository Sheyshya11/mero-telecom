const fs=require('node:fs');
const {PrismaClient}=require('../../../apps/api/node_modules/@prisma/client');
const {hash}=require('../../../apps/api/node_modules/bcryptjs');
process.env.DATABASE_URL='postgresql://mero_telecom:mero_telecom_test_password@localhost:5433/capstone_evidence_20261006';
const db=new PrismaClient();
(async()=>{
 const passwordHash=await hash('ChangeMe123!',12);
 const superUser=await db.user.create({data:{email:'superadmin@merotelecom.test',displayName:'Capstone Super Admin',passwordHash,roles:{create:{role:'SUPER_ADMIN'}}}});
 const plan=await db.internetPlan.findUniqueOrThrow({where:{name:'Essential 50'}});
 const fixtures={superUserId:superUser.id,planId:plan.id};
 for(const [key,first] of [['move','Taylor'],['cancel','Jordan']]){
  const email=key+'@merotelecom.test';
  const user=await db.user.create({data:{email,displayName:first+' Capstone',passwordHash,roles:{create:{role:'CUSTOMER'}}}});
  const customer=await db.customer.create({data:{userId:user.id,customerNumber:'CUST-CAP-'+key.toUpperCase(),firstName:first,lastName:'Capstone',email,phone:'0400000099',addressLine1:'15 King William Street',suburb:'Adelaide',state:'SA',postcode:'5000',addresses:{create:{type:'SERVICE',addressLine1:'15 King William Street',suburb:'Adelaide',state:'SA',postcode:'5000'}}}});
  const address=await db.serviceAddress.create({data:{customerId:customer.id,addressLine1:'15 King William Street',suburb:'Adelaide',state:'SA',postcode:'5000',technology:'FTTP',maximumSpeedMbps:1000}});
  const subscription=await db.subscription.create({data:{customerId:customer.id,planId:plan.id,monthlyCents:plan.monthlyCents,status:'ACTIVE',startDate:new Date('2026-10-01T00:00:00Z'),billingAnchorDay:1,currentPeriodStart:new Date('2026-10-01T00:00:00Z'),currentPeriodEnd:new Date('2026-11-01T00:00:00Z'),currentServiceAddressId:address.id}});
  fixtures[key]={email,userId:user.id,customerId:customer.id,subscriptionId:subscription.id};
 }
 await db.subscription.updateMany({where:{customer:{email:'customer@merotelecom.test'}},data:{currentPeriodStart:new Date('2026-10-01T00:00:00Z'),currentPeriodEnd:new Date('2026-11-01T00:00:00Z')}});
 fs.writeFileSync(__dirname+'/fixtures.json',JSON.stringify(fixtures,null,2));
 console.log('Created Super Admin plus separate cancellation and relocation test customers in capstone_evidence_20261006.');
})().finally(()=>db.$disconnect());
