import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  countActiveApplications,
  getAdminApplicationStatus,
  getAdminCreatorStatus
} from "./adminDirectory.mjs";

const appSource = readFileSync(new URL("./App.jsx", import.meta.url), "utf8");

test("считает только реальные ожидающие заявки активными", () => {
  assert.equal(
    countActiveApplications([
      { status: "PENDING" },
      { status: "PENDING", termsStatus: "REACCEPTANCE_REQUIRED" },
      { status: "APPROVED" },
      { status: "REJECTED" }
    ]),
    2
  );
});

test("показывает обязательное повторное согласие отдельно от обычного ожидания", () => {
  assert.deepEqual(
    getAdminApplicationStatus({
      status: "PENDING",
      termsStatus: "REACCEPTANCE_REQUIRED"
    }),
    { label: "Нужно согласие креатора", type: "danger" }
  );
  assert.deepEqual(
    getAdminApplicationStatus({
      status: "PENDING",
      termsStatus: "CURRENT_ACCEPTED"
    }),
    { label: "На рассмотрении", type: "pending" }
  );
});

test("статус креатора берётся из реального статуса пользователя", () => {
  assert.deepEqual(
    getAdminCreatorStatus({ user: { status: "ACTIVE" } }),
    { label: "Активен", type: "success" }
  );
  assert.deepEqual(
    getAdminCreatorStatus({ user: { status: "BLOCKED" } }),
    { label: "Заблокирован", type: "danger" }
  );
});

test("ADMIN загружает реальные списки и не содержит прежние фиктивные строки", () => {
  assert.match(appSource, /api\("\/admin\/creators"\)/);
  assert.match(appSource, /api\("\/admin\/applications"\)/);
  assert.doesNotMatch(appSource, /<strong>Анна Лебедева<\/strong>/);
  assert.doesNotMatch(appSource, /<td>Мария Фролова<\/td>/);
  assert.doesNotMatch(appSource, /<td>Елена Петрова<\/td>/);
  assert.doesNotMatch(appSource, />37 активных</);
});
