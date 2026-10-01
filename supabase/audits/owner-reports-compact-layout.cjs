// CSS layout probe only: representative markup, no authenticated/data-flow claims.
const fs=require('node:fs');
const assert=require('node:assert/strict');
const {chromium}=require('@playwright/test');
async function main(){
  const browser=await chromium.launch({headless:true});
  try {
    const page=await browser.newPage();
    const css=fs.readFileSync('src/modules/owner/styles/ownerDashboard.css','utf8')+'\n'+fs.readFileSync('src/modules/owner/styles/ownerReports.css','utf8');
    for(const width of [1440,430,390,360]){
      await page.setViewportSize({width,height:900});
      await page.setContent(`<style>body{margin:0;padding:12px;box-sizing:border-box}*{box-sizing:border-box}${css}</style><main class="od-reports report-staff"><div class="od-reports-content"><section class="od-reports-panel"><header class="od-reports-section-title"><h2>Team Activity</h2><p>See the work handled by your team during this period.</p></header><div class="od-reports-table-wrap"><table><thead><tr><th>Staff</th><th>Role</th><th>Activity</th></tr></thead><tbody><tr><td data-label="Staff">A team member with a long name</td><td data-label="Role"><span class="od-reports-status">Cashier</span></td><td data-label="Activity">12 payments · 1,200 ETB</td></tr></tbody></table></div></section><section class="od-reports-state" role="alert"><strong>Couldn’t load inventory</strong><span>We couldn’t retrieve this report. Try again.</span><button>Retry</button></section></div></main>`);
      const result=await page.evaluate(()=>{const style=s=>getComputedStyle(document.querySelector(s));return{width:innerWidth,overflow:document.documentElement.scrollWidth>innerWidth,title:style('h2').fontSize,body:style('td').fontSize,header:style('thead th').fontSize,retryHeight:document.querySelector('button').getBoundingClientRect().height,rowHeight:document.querySelector('tbody tr').getBoundingClientRect().height,tables:document.querySelectorAll('table').length};});
      assert(!result.overflow);assert.equal(result.tables,1);if(width<=430){assert(result.retryHeight>=44);assert.equal(result.title,'19px');assert.equal(result.body,'13px');}
      console.log(JSON.stringify(result));
    }
  } finally {await browser.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
