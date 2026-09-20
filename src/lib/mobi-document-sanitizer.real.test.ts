import {expect, it} from "vitest";
import {parseMobiLayout} from "./mobi-layout";
import {makeMobiFixture} from "./mobi-fixture";
import {sanitizeMobiDocument} from "./mobi-document-sanitizer.mjs";

const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jGZkAAAAASUVORK5CYII=", "base64");

it("真实MOBI布局快照经过章节净化后不保留脚本、事件属性或外链", async () => {
  const bytes = makeMobiFixture({
    resources: [png],
    coverIndex: 0,
    text: '<html><head><style>p{background:url("mobi-resource-v1/1.png")}</style></head><body><script>throw new Error("NO")</script><p onclick="evil()">安全正文<img recindex="1"><img src="https://evil.test/a.png"></p></body></html>',
  });
  const snapshot = await parseMobiLayout(bytes);
  const resourceIds = new Set(snapshot.resources.map(resource => resource.id));
  const safe = await sanitizeMobiDocument(snapshot.chapters[0]!.html, {
    resolve: async value => resourceIds.has(value) ? value : null,
    validate: async (token, role) => resourceIds.has(token) && role === "image",
  });

  expect(safe.html).toContain("安全正文");
  expect(safe.html).toContain("mobi-resource-v1/1.png");
  expect(safe.html).not.toMatch(/<script|onclick=|https:\/\/evil\.test/iu);
  expect(safe.diagnostics.length).toBeGreaterThan(0);
});