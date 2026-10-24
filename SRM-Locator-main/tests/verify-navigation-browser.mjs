import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs';
const browser=await chromium.launch({headless:true,channel:'msedge'});
const page=await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:1});
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:5188/tests/navigation-preview.html');
await page.waitForFunction(()=>window.testMap?.setBearing);
await page.evaluate(()=>window.testMap.setBearing(-90));
await page.waitForTimeout(500);
const heading=await page.locator('.leaflet-marker-icon svg g').first().evaluate(el=>el.style.transform);
assert.ok(/rotate\((0|360)deg\)/.test(heading),heading);
for (const zoom of [17,19,18]) {
  await page.evaluate(z=>window.testMap.setZoom(z,{animate:false}),zoom);
  await page.waitForTimeout(200);
  const error=await page.evaluate(()=>{
    const expected=window.testMap.latLngToContainerPoint([12.8231,80.0442]);
    const marker=document.querySelector('.leaflet-marker-icon svg');
    const b=marker.getBoundingClientRect();
    return Math.hypot(b.x+b.width/2-expected.x,b.y+b.height/2-expected.y);
  });
  assert.ok(error<2,`marker offset at zoom ${zoom}: ${error}`);
}
await page.mouse.click(100,150);
const clickError=await page.evaluate(()=>{
  const p=window.testMap.latLngToContainerPoint(window.clickedPosition);
  return Math.hypot(p.x-100,p.y-150);
});
assert.ok(clickError<2);
fs.mkdirSync('verification',{recursive:true});
await page.screenshot({path:'verification/navigation-mobile.png'});
await page.getByRole('button',{name:'AR Scan',exact:true}).click();
await page.getByRole('textbox',{name:'Rally point description'}).fill('Meet by the gate at 4 pm');
await page.screenshot({path:'verification/rally-description-mobile.png'});
await page.getByRole('button',{name:/Set.*point|Confirm/i}).click();
assert.equal(await page.evaluate(()=>window.rallyDescription),'Meet by the gate at 4 pm');
assert.deepEqual(errors,[]);
fs.writeFileSync('verification/browser.json',JSON.stringify({rotatedHeading:heading,zoomAlignment:true,rotatedClickAlignment:true,rallyDescription:true,errors},null,2));
await browser.close();
console.log('Browser checks passed: rotation, marker alignment at 3 zooms, map clicks and rally descriptions.');
