import {test} from "node:test";
import assert from "node:assert/strict";
import {analyticsPage,readCookieChoice,CONSENT_LIFETIME_MS} from "../lib/analytics.ts";
test("analytics defaults to off for missing, malformed, stale and invalid choices",()=>{
  const now=Date.now();
  for(const value of [null,"bad", "null",JSON.stringify({version:1,analytics:"true",updatedAt:now}),JSON.stringify({version:1,analytics:true,updatedAt:now-CONSENT_LIFETIME_MS}),JSON.stringify({version:1,analytics:true,updatedAt:now+86400000})])assert.equal(readCookieChoice(value,now),null);
  assert.equal(readCookieChoice(JSON.stringify({version:1,analytics:false,updatedAt:now}),now).analytics,false);
  assert.equal(readCookieChoice(JSON.stringify({version:1,analytics:true,updatedAt:now}),now).analytics,true);
});
test("tracking excludes account pages and arbitrary paths, queries and fragments",()=>{
  for(const path of ["/login","/register","/forgot-password","/reset-password","/profile","/settings","/reset-password#token=secret","/api/auth/session","/unknown","/?q=private","/__proto__"])
    assert.equal(analyticsPage(path,"https://app.example"),null);
  assert.deepEqual(analyticsPage("/reels","https://app.example/?q=private#secret"),{page_location:"https://app.example/reels",page_title:"Reels — ReeloGram"});
});
