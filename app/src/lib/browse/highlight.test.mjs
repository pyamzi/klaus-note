import assert from "node:assert/strict";
import { test } from "node:test";
import { searchTerms } from "./highlight.ts";

test("content terms exclude search syntax and metadata", () => {
  assert.deepEqual(searchTerms('deck:"Medical school" tag:exam is:due (heart OR lung) -kidney prop:ivl>5'), ["heart", "lung"]);
});
test("quoted phrases, field searches and accents remain literal", () => {
  assert.deepEqual(searchTerms('"heart failure" Front:mitochondria café cafe\u0301 *muscle*'), ["heart failure", "mitochondria", "café", "muscle"]);
});
test("empty, wildcard and regex searches do not create matches", () => {
  assert.deepEqual(searchTerms('  re:.* nc:resume Front:* Back:_ Front:_* AND +'), []);
});
test("HTML and regex punctuation are returned as literal text", () => {
  assert.deepEqual(searchTerms('"<img onerror=alert>" "a.b" "left/right"'), ["<img onerror=alert>", "a.b", "left/right"]);
});
