import { test } from "node:test";
import assert from "node:assert/strict";
import { uploadToImageKit } from "../lib/uploads/imagekit-upload.ts";
import { UPLOAD_POLICY } from "../lib/uploads/config.ts";

class UploadRequest {
  static latest;
  upload = {};
  aborted = false;
  status = 200;
  responseText = JSON.stringify({ fileId: "test-file" });
  constructor() { UploadRequest.latest = this; }
  open() {}
  send() {}
  abort() { this.aborted = true; this.onabort?.(); }
}
async function start(t) {
  t.mock.method(globalThis, "fetch", async () => new Response(JSON.stringify({token:"token",params:{folder:"/users/test/video",fileName:"random"}})));
  const original = globalThis.XMLHttpRequest;
  globalThis.XMLHttpRequest = UploadRequest;
  t.after(() => { if (original) globalThis.XMLHttpRequest = original; else delete globalThis.XMLHttpRequest; });
  t.mock.timers.enable({apis:["setTimeout"]});
  const result = uploadToImageKit(new File(["video"], "clip.mp4", {type:"video/mp4"}), "video", "public-key", () => {});
  // Let JSON decoding complete before advancing the upload clock.
  await new Promise(resolve => setImmediate(resolve));
  return {result, xhr:UploadRequest.latest};
}
test("a steadily progressing video can upload for longer than two minutes", async t => {
  const {result,xhr} = await start(t);
  for (let index=0;index<6;index++) {
    t.mock.timers.tick(60000);
    xhr.upload.onprogress({lengthComputable:true,loaded:index+1,total:8});
    assert.equal(xhr.aborted,false);
  }
  assert.equal(xhr.timeout,UPLOAD_POLICY.maximumMs);
  xhr.onload();
  assert.equal(await result,"test-file");
});
test("a stalled transfer is aborted with a retry message and no repeated upload", async t => {
  const {result,xhr} = await start(t);
  const rejected = assert.rejects(result,/stopped making progress/);
  t.mock.timers.tick(UPLOAD_POLICY.inactivityMs);
  await rejected;
  assert.equal(xhr.aborted,true);
});
test("an upload service rejection never becomes a successful file ID", async t => {
  const {result,xhr} = await start(t);
  const rejected = assert.rejects(result,/couldn’t accept this file size/);
  xhr.status=413;
  xhr.responseText=JSON.stringify({message:"Too large"});
  xhr.onload();
  await rejected;
});
