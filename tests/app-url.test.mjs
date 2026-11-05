import assert from "node:assert/strict";
import { test } from "node:test";
import { appOrigin, AppUrlConfigurationError } from "../lib/config/app-url.ts";
import { configureNextAuthEnvironment } from "../lib/auth/environment.ts";
import { absoluteUrl } from "../lib/seo/config.ts";
import { passwordChangedEmail } from "../lib/email/templates.ts";

test("one configured origin drives auth, email and SEO after a domain change", () => {
  const environment = {
    REELOGRAM_APP_URL: "https://new.example/",
    REELOGRAM_NEXTAUTH_URL: "https://retired.example",
  };
  assert.equal(appOrigin(environment), "https://new.example");
  configureNextAuthEnvironment(environment);
  assert.equal(environment.NEXTAUTH_URL, "https://new.example");
  const previous = process.env.REELOGRAM_APP_URL;
  try {
    for (const origin of ["https://first.example", "https://second.example"]) {
      process.env.REELOGRAM_APP_URL = origin;
      assert.equal(absoluteUrl("/sitemap.xml"), `${origin}/sitemap.xml`);
      const message = passwordChangedEmail("user@example.com");
      assert.ok(message.html.includes(`${origin}/login`));
      assert.ok(message.html.includes(`${origin}/privacy`));
      assert.ok(message.text.includes(`${origin}/login`));
      assert.ok(!message.html.includes("retired.example"));
    }
  } finally {
    if (previous === undefined) delete process.env.REELOGRAM_APP_URL;
    else process.env.REELOGRAM_APP_URL = previous;
  }
});

test("app URLs accept secure origins and explicit local development only", () => {
  assert.equal(
    appOrigin({ REELOGRAM_NEXTAUTH_URL: "https://fallback.example/" }),
    "https://fallback.example",
  );
  for (const origin of [
    "https://app.example",
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://[::1]:3000",
  ]) {
    assert.equal(appOrigin({ REELOGRAM_APP_URL: origin }), origin);
  }
  assert.throws(() => appOrigin({}), AppUrlConfigurationError);
  for (const origin of [
    "invalid",
    "//app.example",
    "http://app.example",
    "javascript:alert(1)",
    "https://user:password@app.example",
    "https://app.example/path",
    "https://app.example?next=evil",
    "https://app.example#token",
  ]) {
    assert.throws(
      () => appOrigin({ REELOGRAM_APP_URL: origin }),
      AppUrlConfigurationError,
    );
  }
});
