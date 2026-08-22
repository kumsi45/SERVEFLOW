import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles=readFileSync(resolve(process.cwd(),"src/modules/manager/styles/managerOperationsCenter.css"),"utf8");
const markup=`<main class="moc-page"><section class="moc-panel moc-actions"><div class="moc-section-head"><div><span>Intervention queue</span><h2>Manager Actions <b>1</b></h2></div></div><div class="moc-action-list"><article class="moc-request-action attention"><header><div><span>Kitchen Material Request</span><h3>Extra Fine Imported Brown Sugar With A Very Long Item Name</h3></div><span class="moc-status amber">Pending Manager Review</span></header><dl><div><dt>Quantity</dt><dd>2 kg</dd></div><div><dt>Station</dt><dd>Beverages and Cold Drinks Preparation</dd></div><div><dt>Requested by</dt><dd>Sude With A Long Staff Name</dd></div><div class="is-wide"><dt>Reason</dt><dd>Low stock for juice preparation during unexpected customer demand.</dd></div><div><dt>Requested</dt><dd>Today, 10:35 AM</dd></div><div><dt>Waiting</dt><dd>2h 14m</dd></div></dl><footer><button>Review Request</button><button class="secondary">Check Inventory</button></footer></article></div></section></main>`;

for(const viewport of [{name:"desktop",width:1440,height:900},{name:"laptop",width:1024,height:768},{name:"tablet",width:768,height:1024},{name:"mobile",width:375,height:812}]){
  test(`kitchen request remains readable without overflow at ${viewport.name}`,async({page})=>{
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;background:#f6f8fb}.moc-page{padding:16px}${styles}</style>${markup}`);
    const geometry=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
    await expect(page.getByText("Extra Fine Imported Brown Sugar With A Very Long Item Name")).toBeVisible();
    await expect(page.getByText("Low stock for juice preparation during unexpected customer demand.")).toBeVisible();
    const buttons=page.locator(".moc-request-action footer button");
    await expect(buttons).toHaveCount(2);
    if(viewport.width<=767){for(let index=0;index<2;index+=1)expect((await buttons.nth(index).boundingBox())?.height).toBeGreaterThanOrEqual(44);}
  });
}
