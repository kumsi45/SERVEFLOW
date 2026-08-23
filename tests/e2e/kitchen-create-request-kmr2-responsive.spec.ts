import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { expect, test } from "@playwright/test";

const styles=readFileSync(resolve(process.cwd(),"src/modules/kitchen/styles/kitchenDashboard.css"),"utf8");
const markup=`
<main class="kd-root">
  <div class="kd-request-layer">
    <form class="kd-request-form" role="dialog" aria-label="Create Request">
      <header class="kd-request-header"><div><h2>Create Request</h2><p>Request a material for Beverages.</p></div><button type="button" aria-label="Close Create Request">×</button></header>
      <div class="kd-request-scroll">
        <label class="kd-request-field kd-request-wide"><span>Request Type</span><select><option>Ingredient / Food Material</option><option>Kitchen Supply</option><option>Tool / Equipment</option><option>Cleaning / Consumable</option><option>Other</option></select></label>
        <div class="kd-request-field kd-request-wide"><span>Item</span><div class="kd-request-item-search"><input type="search" placeholder="Search inventory..."><div class="kd-request-item-results" role="listbox"><button type="button"><strong>Extra Fine Imported Brown Sugar</strong><small>20 kg available</small></button><button type="button"><strong>Milk</strong><small>12 L available</small></button></div></div></div>
        <label class="kd-request-field"><span>Quantity</span><input type="number" value="2"></label>
        <label class="kd-request-field"><span>Unit</span><div class="kd-request-readonly">kg</div></label>
        <label class="kd-request-field"><span>Urgency</span><select><option>Normal</option></select></label>
        <div class="kd-request-field"><span>Station</span><div class="kd-request-readonly">Beverages</div></div>
        <label class="kd-request-field kd-request-wide"><span>Reason / Note <small>Optional</small></span><textarea rows="2" placeholder="Add a short note..."></textarea></label>
      </div>
      <footer class="kd-request-actions"><button type="button">Cancel</button><button type="submit">Submit Request</button></footer>
    </form>
  </div>
</main>`;

const viewports=[
  {name:"1280 tablet",width:1280,height:800,columns:2},
  {name:"1180 tablet",width:1180,height:820,columns:2},
  {name:"1024 tablet",width:1024,height:768,columns:2},
  {name:"768 portrait tablet",width:768,height:1024,columns:1},
  {name:"390 mobile",width:390,height:844,columns:1},
  {name:"375 mobile",width:375,height:812,columns:1},
] as const;

for(const viewport of viewports){
  test(`Create Request is reachable without overflow at ${viewport.name}`,async({page})=>{
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await page.setContent(`<meta name="viewport" content="width=device-width, initial-scale=1"><style>*{box-sizing:border-box}html,body{margin:0;width:100%;height:100%;overflow:hidden}${styles}</style>${markup}`);

    const dialog=page.getByRole("dialog",{name:"Create Request"});
    await expect(dialog).toBeVisible();
    await expect(page.getByRole("button",{name:"Submit Request"})).toBeVisible();
    await expect(page.getByLabel("Request Type")).toHaveValue("Ingredient / Food Material");
    await expect(page.getByText("Beverages",{exact:true})).toBeVisible();

    const geometry=await page.evaluate(()=>{
      const form=document.querySelector<HTMLElement>(".kd-request-form")!;
      const scroll=document.querySelector<HTMLElement>(".kd-request-scroll")!;
      const submit=document.querySelector<HTMLElement>(".kd-request-actions button:last-child")!;
      const formBox=form.getBoundingClientRect();
      const submitBox=submit.getBoundingClientRect();
      return {
        documentWidth:document.documentElement.scrollWidth,
        viewportWidth:document.documentElement.clientWidth,
        formLeft:formBox.left,
        formRight:formBox.right,
        formWidth:formBox.width,
        submitBottom:submitBox.bottom,
        columns:getComputedStyle(scroll).gridTemplateColumns.split(" ").length,
      };
    });
    expect(geometry.documentWidth).toBeLessThanOrEqual(geometry.viewportWidth);
    expect(geometry.formLeft).toBeGreaterThanOrEqual(0);
    expect(geometry.formRight).toBeLessThanOrEqual(viewport.width);
    expect(geometry.submitBottom).toBeLessThanOrEqual(viewport.height);
    expect(geometry.columns).toBe(viewport.columns);
    if(viewport.width>=800)expect(geometry.formWidth).toBeLessThanOrEqual(640);
    if(viewport.width<=620)expect(geometry.formWidth).toBe(viewport.width);
  });
}
