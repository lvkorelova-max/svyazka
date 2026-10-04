import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("CreatorDashboard receives and reads creator notifications", () => {
  assert.match(
    source,
    /const \[creatorNotifications, setCreatorNotifications\] = useState\(/,
  );
  assert.match(
    source,
    /<CreatorDashboard[^>]*notifications=\{creatorNotifications\}/,
  );
  assert.match(source, /notifications\.counts\?\.unread \|\| 0/);
});
