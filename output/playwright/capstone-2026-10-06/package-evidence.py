from pathlib import Path
import json, shutil, hashlib, zipfile, html
from datetime import datetime, timezone
root=Path(r'D:\MeroTelecom\output\playwright\capstone-2026-10-06')
out=root/'evidence-pack'
out.mkdir(exist_ok=True)
results=json.loads((root/'real-test-results.json').read_text(encoding='utf-8-sig'))
assert all(x['passed'] for x in results['assertions']), 'Final live assertions must pass'
units=json.loads((root/'focused-test-results.json').read_text(encoding='utf-8-sig'))
unit_summary=[{k:x[k] for k in ('id','name','startedUtc','durationSeconds','passed','failed','pending','suites','paths')} for x in units]
for x in unit_summary: x['evidenceScope']='Supplemental existing Jest unit/service tests with mocked dependencies.'
(out/'supporting-unit-test-results.json').write_text(json.dumps(unit_summary,indent=2),encoding='utf-8')
for name in ('real-test-results.json','live-api-verification.txt'): shutil.copy2(root/name,out/name)
cases=[
('TC01','Authentication and Role Access','PASS','Signed in as Customer, Staff, Admin and Super Admin and captured the correct dashboards. A customer visiting an admin page returned to the customer dashboard. Live API checks rejected invalid credentials (401), denied customer/staff access to administrative user management (403), and restricted security audit logs to Super Admin (Admin 403, Super Admin 200).','TC01-a-customer-dashboard.png'),
('TC02','Coverage Checking','PASS','Selected recognised addresses and performed real coverage checks: 100 King William Street, Adelaide SA 5000 returned AVAILABLE with FTTP and compatible plans; 15 King William Street, Rosewater SA 5013 returned NOT_AVAILABLE. This verifies configured database estimates; it does not establish live NBN serviceability.','TC02-a-supported-coverage.png'),
('TC03','Subscription and Payment','PASS','Maya selected Family 100 and completed the actual hosted Stripe sandbox checkout with a 4242 test card. The application received signed Stripe webhook events, recorded an AUD79.00 succeeded payment and paid invoice INV-2026-000004, and displayed the subscription as Active with automatic payments. The same subscription was subsequently used for TC05, changing its final status to CANCELLATION_PENDING.','TC03-c-paid-active-subscription.png'),
('TC04','Duplicate Monthly Invoice Prevention','PASS','Generated October invoice INV-2026-000005 for Anika. The UI then displayed October 2026 invoice already exists and replaced generation with View invoice. Two concurrent API requests for 6 and 19 October returned the same invoice with generationResult EXISTING; database count stayed at exactly one invoice for that subscription and October period.','TC04-duplicate-october-invoice-prevented.png'),
('TC05','Cancellation and Refund Review','PASS','Submitted a refund request for the sandbox payment, started administrative review, and confirmed UNDER_REVIEW on both employee and customer screens. Submitted cancellation CAN-2026-00001, approved it, and scheduled it for 7 November 2026. Stripe sandbox cancellation-at-period-end synchronised; the subscription is CANCELLATION_PENDING with no end date yet. Refund payout and physical network disconnection were outside this request-and-review test.','TC05-c-administrative-refund-review.png'),
('TC06','Service Relocation','PARTIAL PASS','Taylor submitted a move from 15 to 100 King William Street, Adelaide, kept Essential 50, and selected 10 October 2026. Employee review approved and scheduled the request. Database qualification was AVAILABLE and the original subscription/address stayed active. The provider is MOCK_MNF: live NBN/MNF provisioning, physical activation and old-service disconnection were not tested.','TC06-b-administrative-relocation-monitoring.png'),
('TC07','Ticket Escalation','PASS','Created support case SUP-2026-00001. Staff raised linked internal request IR-2026-00001; Admin took ownership, started review and escalated it to Super Admin; Super Admin took ownership. Persisted audit events confirm the same request moved from ADMIN to SUPER_ADMIN with the support link and role ownership retained. Resolution was not part of the escalation test.','TC07-c-super-admin-review.png'),
('TC08','Notifications','PASS','Real billing, refund, cancellation, relocation and escalation actions generated in-app notifications for the relevant users. Captured employee and customer lists, marked a customer notification read in the browser, and confirmed the read state persisted. The API returned only the logged-in customer records and rejected another user changing that notification (404).','TC08-a-super-admin-event-notifications.png')]
exclude={'TC04-automated.png','TC05-a-customer-refund-request.png'}
manifest=[]
sections=[]
readme=['# Mero Telecom — Eight Real Test Cases','', 'Executed 6 October 2026 UTC / 7 October 2026 in Australia/Adelaide.','',f'{sum(x["passed"] for x in results["assertions"])} live API/database assertions passed. Seven assignment cases passed within their stated scope; relocation is a partial pass.','', 'These PNG files were captured from the running application in a real Chrome browser. The application used a fresh isolated PostgreSQL database, Redis, real Geoapify address suggestions, and Stripe sandbox checkout/webhooks. Local test emails were routed to Mailpit. The screenshots have not been recreated or edited.','', 'Extract the ZIP and open index.html to browse all screenshots. Individual full-resolution PNG files are organised into TC01–TC08 folders.','', '## Results','']
for code,title,status,description,primary in cases:
    folder=out/code;folder.mkdir(exist_ok=True)
    files=[p for p in sorted(root.glob(code+'*.png')) if p.name not in exclude]
    assert files
    cards=[]
    readme += [f'### {code} — {title} ({status})','',description,'','Screenshots:','']
    for p in files:
        dest=folder/p.name;shutil.copy2(p,dest)
        relative=dest.relative_to(out).as_posix()
        digest=hashlib.sha256(dest.read_bytes()).hexdigest()
        manifest.append({'testCase':code,'file':relative,'sha256':digest,'sizeBytes':dest.stat().st_size,'capturedUtc':datetime.fromtimestamp(p.stat().st_mtime,timezone.utc).isoformat()})
        label=p.stem.replace(code+'-','').replace('-',' ')
        if p.name=='TC07-c-super-admin-review.png': label='Super Admin ownership and escalation history'
        readme.append(f'- [{p.name}]({relative})')
        cards.append(f'<a class="shot" href="{relative}" target="_blank"><img loading="lazy" src="{relative}" alt="{html.escape(label)}"><span>{html.escape(label)}</span></a>')
    readme.append('')
    checks=[x for x in results['assertions'] if x['testCase']==code]
    sections.append(f'<section id="{code}"><div class="section-head"><h2>{code} · {html.escape(title)}</h2><span class="badge {"partial" if status=="PARTIAL PASS" else ""}">{status}</span></div><p>{html.escape(description)}</p><p class="checks">{len(checks)} live API/database checks passed</p><div class="gallery">'+''.join(cards)+'</div></section>')
readme += ['## Verification files','', '- real-test-results.json: sanitised final API/database assertions, coverage results, and notification recipients.', '- live-api-verification.txt: readable final assertion output.', '- screenshot-manifest.json: capture times, file sizes and SHA-256 hashes.', f'- supporting-unit-test-results.json: {sum(x["passed"] for x in units)} passing existing Jest unit/service checks with mocked dependencies, supplemental to the real workflows.','', 'TC03 was captured before TC05 changed that customer’s subscription lifecycle. The Active checkout screenshot and cancellation’s recorded subscriptionStatusBefore=ACTIVE preserve that sequence. Coverage and relocation are database estimates; network-provider results are simulated. TC05 verifies request/review/scheduling, not refund settlement or live disconnection.']
(out/'README.md').write_text('\n'.join(readme),encoding='utf-8')
(out/'screenshot-manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
nav=''.join(f'<a href="#{c[0]}">{c[0]}</a>' for c in cases)
page='''<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mero Telecom — Real Test Screenshots</title><style>
*{box-sizing:border-box}body{margin:0;background:#f3f6fa;color:#18334b;font:16px/1.6 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:44px 24px}h1{font-size:36px;line-height:1.2;margin:12px 0}h2{font-size:23px;margin:0}header{background:#153e60;color:white;padding:32px;border-radius:16px}header p{max-width:920px}nav{display:flex;flex-wrap:wrap;gap:10px;margin:22px 0}nav a{background:white;color:#174d73;padding:8px 16px;border-radius:8px;text-decoration:none;font-weight:700}section{background:white;border:1px solid #dbe4ec;padding:26px;border-radius:14px;margin:24px 0;scroll-margin-top:20px}.section-head{display:flex;align-items:center;justify-content:space-between;gap:12px}.badge{font-size:12px;font-weight:800;white-space:nowrap;color:#006745;background:#e1f5ec;padding:6px 12px;border-radius:20px}.partial{color:#815203;background:#fff1cb}.checks{font-size:13px;color:#487086}.gallery{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}.shot{border:1px solid #dce5ed;border-radius:9px;overflow:hidden;color:#193d59;text-decoration:none;background:#f9fbfd}.shot img{width:100%;height:340px;object-fit:contain;object-position:top;background:#edf2f6;display:block}.shot span{display:block;padding:12px;font-size:14px;font-weight:600}footer{font-size:14px;color:#516a7f}a{color:#176295}@media(max-width:700px){.gallery{grid-template-columns:1fr}.section-head{align-items:flex-start}h1{font-size:29px}main{padding:20px 12px}section{padding:18px}}
</style></head><body><main><header><small>CAPSTONE FUNCTIONAL TEST EVIDENCE</small><h1>Eight cases. Real browser screenshots.</h1><p>22 full-resolution screenshots captured from Mero Telecom. Seven cases passed within the documented scope; service relocation is a partial pass because live NBN/MNF provisioning is unavailable.</p><p>6 October 2026 UTC · 7 October 2026 Australia/Adelaide · Stripe sandbox · Isolated test database</p></header><nav>'''+nav+'''</nav><p>Click a screenshot to open the original full-resolution PNG. <a href="README.md">Results guide</a> · <a href="real-test-results.json">Live verification</a> · <a href="screenshot-manifest.json">Screenshot manifest</a></p>'''+''.join(sections)+'''<footer>Existing Jest unit/service checks also passed (170). They are supplemental and use mocked dependencies. The screenshots above are original browser captures from the live application. Refund payout and live network disconnection were not part of the request-and-review test.</footer></main></body></html>'''
(out/'index.html').write_text(page,encoding='utf-8')
# Replace the obsolete earlier unit-only index with a pointer to completed evidence.
(root/'index.html').write_text('<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=evidence-pack/index.html"><title>Real Test Evidence</title><a href="evidence-pack/index.html">Open the completed real test screenshots</a>',encoding='utf-8')
zip_path=root.parent/'Mero-Telecom-8-Real-Test-Cases.zip'
with zipfile.ZipFile(zip_path,'w',zipfile.ZIP_DEFLATED) as z:
    for p in sorted(out.rglob('*')):
        if p.is_file(): z.write(p,p.relative_to(out).as_posix())
with zipfile.ZipFile(zip_path) as z:
    assert z.testzip() is None
    for entry in manifest: assert hashlib.sha256(z.read(entry['file'])).hexdigest()==entry['sha256']
print(json.dumps({'zip':str(zip_path),'screenshots':len(manifest),'cases':len(cases),'liveAssertions':len(results['assertions']),'unitChecks':sum(x['passed'] for x in units),'zipBytes':zip_path.stat().st_size,'gallery':str(out/'index.html')},indent=2))
