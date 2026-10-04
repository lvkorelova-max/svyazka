import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default || traverseModule;
const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");
const ast = parse(appSource, { sourceType: "module", plugins: ["jsx"] });

function findManagerPath() {
  let managerPath = null;
  traverse(ast, {
    FunctionDeclaration(path) {
      if (path.node.id?.name === "BrandCreatorKitManager") managerPath = path;
    }
  });
  return managerPath;
}

test("BrandCreatorKitManager has a clean current-UI dependency surface", () => {
  const managerPath = findManagerPath();
  assert.ok(managerPath, "BrandCreatorKitManager declaration must exist");

  const unresolved = new Map();
  managerPath.traverse({
    ReferencedIdentifier(path) {
      const name = path.node.name;
      if (["window", "document"].includes(name) || path.scope.hasBinding(name)) return;
      const lines = unresolved.get(name) || [];
      lines.push(path.node.loc?.start.line);
      unresolved.set(name, lines);
    }
  });

  assert.deepEqual(Object.fromEntries(unresolved), {});

  let resetEditorBinding = false;
  let resetEditorCall = false;
  managerPath.traverse({
    VariableDeclarator(path) {
      if (path.node.id.type === "Identifier" && path.node.id.name === "resetEditor") {
        resetEditorBinding = true;
      }
    },
    CallExpression(path) {
      if (path.node.callee.type === "Identifier" && path.node.callee.name === "resetEditor") {
        resetEditorCall = true;
      }
    }
  });
  assert.equal(resetEditorBinding, true);
  assert.equal(resetEditorCall, true);

  const managerSource = appSource.slice(
    managerPath.node.loc.start.index,
    managerPath.node.loc.end.index
  );
  for (const removedDependency of [
    "previewAccess",
    "setRestoreDetails",
    "loadMetadata",
    "saveContent",
    "publishKit",
    "createDraftFromRevision",
    "previewRestore",
    "restoreRevision",
    "changeProductAccess"
  ]) {
    assert.doesNotMatch(managerSource, new RegExp(`\\b${removedDependency}\\b`));
  }
});
