import { test } from "node:test";
import assert from "node:assert/strict";
import {
  jsonLd,
  xml,
  validVideoId,
  PRIVATE_PAGES,
  PUBLIC_PAGES,
} from "../lib/seo/config.ts";
test("untrusted video text cannot escape JSON-LD or sitemap XML", () => {
  const payload = '</script><script>alert("x")</script> & \u2028';
  const data = jsonLd({ name: payload });
  assert.ok(!data.includes("<"));
  assert.deepEqual(JSON.parse(data), { name: payload });
  assert.equal(
    xml('<x a="b">&\u0000</x>'),
    "&lt;x a=&quot;b&quot;&gt;&amp;&lt;/x&gt;",
  );
});
test("private routes are excluded and public IDs reject path/query injection", () => {
  assert.ok(PRIVATE_PAGES.every((path) => !PUBLIC_PAGES.includes(path)));
  assert.equal(validVideoId("0123456789abcdef01234567"), true);
  for (const id of ["../profile", "123", "$ne", "0123456789abcdef01234567?x"])
    assert.equal(validVideoId(id), false);
});
