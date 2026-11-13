import { test } from "node:test";
import assert from "node:assert/strict";
import { describeAction, formatActionTime } from "../src/lib/action-log";

test("sync records describe the current state without looking like a scheduled close", () => {
  assert.equal(
    describeAction("initial_sync", "deactivate", "success"),
    "初始同步完成 · 状态关闭",
  );
  assert.equal(
    describeAction("state_sync", "deactivate", "success"),
    "状态同步完成 · 状态关闭",
  );
  assert.equal(
    describeAction("config_sync", "activate", "failed"),
    "配置同步失败 · 目标状态开启",
  );
  assert.equal(
    describeAction("scheduled", "deactivate", "success"),
    "定时关闭 · 成功",
  );
});

test("unknown historical sources stay neutral instead of being called scheduled", () => {
  assert.equal(
    describeAction("unknown", "deactivate", "success"),
    "执行关闭 · 成功",
  );
});

test("timestamps show both Moscow shop time and Beijing time explicitly", () => {
  assert.equal(
    formatActionTime("2026-11-13T09:45:22.334Z", "Europe/Moscow"),
    "莫斯科时间 2026-11-13 12:45:22 · 北京时间 2026-11-13 17:45:22",
  );
  assert.equal(
    formatActionTime("2026-11-13T09:45:22.334Z", "Asia/Shanghai"),
    "北京时间 2026-11-13 17:45:22 · 莫斯科时间 2026-11-13 12:45:22",
  );
});
