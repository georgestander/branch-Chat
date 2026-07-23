import assert from "node:assert/strict";
import test from "node:test";

import {
  DEFAULT_COMPOSER_SETTINGS,
  inferComposerPreset,
  settingsForModel,
  settingsForPreset,
  settingsForReasoningEffort,
  settingsWithWebSearch,
} from "./composer-settings.ts";

test("preset selection restores the original canvas defaults", () => {
  assert.deepEqual(settingsForPreset("fast"), {
    model: "gpt-5.6-terra",
    reasoningEffort: "medium",
    preset: "fast",
    tools: ["web-search"],
  });
  assert.deepEqual(settingsForPreset("reasoning"), {
    model: "gpt-5.6-sol",
    reasoningEffort: "high",
    preset: "reasoning",
    tools: ["web-search"],
  });
  assert.deepEqual(settingsForPreset("study"), {
    model: "gpt-5.6-sol",
    reasoningEffort: "medium",
    preset: "study",
    tools: ["study-and-learn", "web-search"],
  });
});

test("explicit settings changes infer custom mode", () => {
  assert.equal(
    settingsForModel(DEFAULT_COMPOSER_SETTINGS, "gpt-5.6-luna").preset,
    "custom",
  );
  assert.equal(
    settingsForReasoningEffort(
      settingsForPreset("reasoning"),
      "ultra",
    ).preset,
    "custom",
  );
  assert.equal(
    settingsWithWebSearch(settingsForPreset("fast"), false).preset,
    "custom",
  );
});

test("web search toggles preserve unrelated composer tools", () => {
  const studyWithoutSearch = settingsWithWebSearch(
    settingsForPreset("study"),
    false,
  );
  assert.deepEqual(studyWithoutSearch.tools, ["study-and-learn"]);

  const studyRestored = settingsWithWebSearch(studyWithoutSearch, true);
  assert.deepEqual(studyRestored.tools, ["study-and-learn", "web-search"]);
  assert.equal(inferComposerPreset(studyRestored), "study");
});

test("unsupported ultra effort falls back to the model maximum", () => {
  const selection = settingsForReasoningEffort(
    settingsForModel(settingsForPreset("reasoning"), "gpt-5.6-luna"),
    "ultra",
  );
  assert.equal(selection.reasoningEffort, "max");
});
