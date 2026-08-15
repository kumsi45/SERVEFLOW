import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const css=readFileSync(resolve(process.cwd(),"src/modules/manager/styles/managerOperationalReports.css"),"utf8");
const markup=`<main class="mor-page"><header class="mor-header"><div><span>Historical operational truth</span><h1>Manager Reports</h1><p>Grand Royal · prepared for Manager</p></div><div class="mor-header-actions"><button><span>Refresh</span></button><button><span>Download PDF</span></button><button><span>Export CSV</span></button></div></header><section class="mor-period"><div class="mor-period-buttons"><button class="active">today</button><button>week</button><button>month</button><button>custom</button></div><div class="mor-custom-dates"><label>From<input type="date"></label><label>Through<input type="date"></label></div><p>10/08/2026 – 15/08/2026 · Africa/Nairobi</p></section><nav class="mor-tabs">${["Overview","Menu Performance","Sales & Payments","Cashier & Shifts","Kitchen","Staff Operations","Inventory","Guests & Tables","Exceptions & Incidents"].map((label)=>`<button>${label}</button>`).join("")}</nav><section class="mor-report-content"><div class="mor-flow"><section class="mor-metrics is-overview">${Array.from({length:8},(_,index)=>`<article class="mor-metric"><span>Metric ${index+1}</span><strong>1,234</strong><small>Factual detail</small></article>`).join("")}</section><section class="mor-panel"><header class="mor-section-title"><div><span>Recorded workload</span><h2>Staff Operations</h2><p>Attributed activity facts only.</p></div></header><div class="mor-table-wrap"><table class="mor-table"><thead><tr>${["Staff","Role","Orders / assignments","Requests / cancellations","Cashier activity","Kitchen activity","Inventory activity","Recorded total"].map((label)=>`<th>${label}</th>`).join("")}</tr></thead><tbody><tr>${["Hana","Waiter","4 / 2","1 / 0","0 shifts","0 completed","0 movements","7"].map((value,index)=>`<td data-label="${index}">${value}</td>`).join("")}</tr></tbody></table></div></section></div></section></main>`;

for(const viewport of [{name:"desktop",width:1440,height:900},{name:"laptop",width:1024,height:800},{name:"tablet",width:768,height:900},{name:"mobile",width:375,height:812}]){
  test(`Manager Reports V1 has no page overflow at ${viewport.name}`,async({page})=>{
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}body{margin:0;padding:16px;background:#f5f7fa;font-family:Arial,sans-serif}${css}</style>${markup}`);
    const geometry=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,client:document.documentElement.clientWidth}));
    expect(geometry.scroll).toBeLessThanOrEqual(geometry.client);
    await expect(page.locator(".mor-tabs")).toBeVisible(); await expect(page.locator(".mor-period-buttons")).toBeVisible();
    if(viewport.width<=780){await expect(page.locator(".mor-table thead")).toHaveCSS("position","absolute");await expect(page.locator(".mor-table td").first()).toHaveCSS("display","grid");}
    else await expect(page.locator(".mor-table")).toBeVisible();
  });
}
