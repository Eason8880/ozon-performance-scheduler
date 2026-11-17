import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (path: string) =>
  readFileSync(new URL(path, import.meta.url), "utf8");

test("store list selects the ownership group without changing access filtering", () => {
  const source = read("../src/app/api/stores/route.ts");
  assert.match(source, /select s\.id,s\.name,s\.owner_group,/);
  assert.match(source, /where \$1='admin' or s\.owner_group=\$1/);
});

test("shop name includes an admin-only badge with the raw group or administrator fallback", () => {
  const source = read("../src/app/page.tsx");
  assert.match(source, /owner_group: string \| null/);
  assert.match(
    source,
    /<h3>\{store\.name\}<\/h3>\s*\{group === "admin" && \(\s*<span className="store-group"[^>]*>\s*\{store\.owner_group \?\? "管理员"\}\s*<\/span>\s*\)\}/,
  );
});

test("loaded session preserves the raw group used by the badge visibility check", () => {
  const source = read("../src/app/page.tsx");
  assert.match(source, /G\(result\.group\)/);
  assert.doesNotMatch(source, /G\(\s*result\.group ===/);
  assert.match(source, /group === "admin"\s*\? "管理员，可管理全部店铺"/);
});
