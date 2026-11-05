import assert from "node:assert/strict";
import {test} from "node:test";
import {publicUploader} from "../lib/public-uploader.ts";
test("public uploader identities omit email and use a real name or legacy handle",()=>{
 const owner=publicUploader({_id:"user",name:" Kumar Kaushik ",email:"private@example.com",image:"https://ik.imagekit.io/account/avatar.jpg"});
 assert.equal(owner.name,"Kumar Kaushik");assert.equal(owner.image,"https://ik.imagekit.io/account/avatar.jpg");assert.ok(!("email" in owner));
 assert.equal(publicUploader({_id:"old",email:"legacy@example.com"}).name,"legacy");
 assert.equal(publicUploader({_id:"old",image:"javascript:alert(1)"}).image,undefined);
});
