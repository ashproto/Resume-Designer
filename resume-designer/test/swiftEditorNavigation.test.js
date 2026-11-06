import { describe, expect, it } from 'vitest';
import { readFileSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

function declaration(source, marker) {
  const start = source.indexOf(marker);
  expect(start, `Missing production editor declaration: ${marker}`).toBeGreaterThanOrEqual(0);
  let cursor = source.indexOf('{', start);
  let depth = 1;
  for (cursor += 1; cursor < source.length && depth; cursor += 1) {
    if (source[cursor] === '{') depth += 1;
    if (source[cursor] === '}') depth -= 1;
  }
  return source.slice(start, cursor);
}

describe.skipIf(process.platform !== 'darwin')('native focused editor navigation', () => {
  it('keeps the selected row presentation identity while its live command key materializes', () => {
    const source = readFileSync('src-tauri/ios/OPShell.swift', 'utf8');
    const candidate = declaration(source, 'struct NativeEditorSelectionCandidate: Equatable');
    const resolver = declaration(source, 'func resolveNativeEditorSelection(');
    const value = declaration(source, 'enum NativeEditorNavigationValue: Hashable');
    const destination = declaration(source, 'struct NativeEditorDestination: Equatable');
    const directory = mkdtempSync(join(tmpdir(), 'on-paper-editor-presentation-'));
    try {
      const program = `import Foundation\n${candidate}\n${resolver}\n${value}\n${destination}\n
let original = NativeEditorDestination(key: "section:@4")
let navigationValue = original.navigationValue
let rows = [NativeEditorSelectionCandidate(key: "section:highlights", groupIds: ["section-4"])]
// Resolve from the new snapshot before any deferred SwiftUI onChange callback.
let materialized = original.resolving(candidates: rows, remappingKey: "section:@4", remappingGroupIds: ["section-4"], contextMatches: true)!
precondition(materialized.key == "section:highlights", "Commands must use the current materialized key")
precondition(materialized.navigationValue == navigationValue, "The selected destination must not change identity and pop nested options")
precondition(materialized.navigationValue(for: "section:highlights") == navigationValue, "The live selected outline row must retain its original navigation value and row identity")
precondition(materialized.navigationValue(for: "section:@4") != navigationValue, "A different row reusing the old positional key must never share the selected identity")
precondition(materialized.navigationValue(for: "section:other") == original.navigationValue(for: "section:other"), "Unrelated row identities must remain stable")
precondition(materialized.resolving(candidates: rows, remappingKey: nil, remappingGroupIds: [], contextMatches: true) == materialized, "Ordinary snapshots must retain the complete destination")
precondition(materialized.resolving(candidates: [], remappingKey: nil, remappingGroupIds: [], contextMatches: true) == nil, "Deleted selection must discard the presentation identity")
precondition(materialized.resolving(candidates: rows, remappingKey: nil, remappingGroupIds: [], contextMatches: false) == nil, "Stale context must discard presentation identity even when the live key exists")
let newlyChosen = NativeEditorDestination(key: "section:other")
precondition(newlyChosen.navigationValue != navigationValue, "Choosing another section must have its own destination")
print("presentation behavior passed")
`;
      const file = join(directory, 'main.swift');
      writeFileSync(file, program);
      const output = execFileSync('xcrun', ['swift', '-module-cache-path', join(directory, 'module-cache'), file], { encoding: 'utf8', timeout: 30_000 });
      expect(output).toContain('presentation behavior passed');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('retains known materialized identities and refuses ambiguous or stale destinations', () => {
    const source = readFileSync('src-tauri/ios/OPShell.swift', 'utf8');
    const candidate = declaration(source, 'struct NativeEditorSelectionCandidate: Equatable');
    const resolver = declaration(source, 'func resolveNativeEditorSelection(');
    const directory = mkdtempSync(join(tmpdir(), 'on-paper-editor-navigation-'));
    try {
      const program = `import Foundation\n${candidate}\n${resolver}\n
func resolve(_ key: String?, _ rows: [NativeEditorSelectionCandidate], _ changing: String? = nil, _ groups: [String] = [], _ current: Bool = true) -> String? {
  resolveNativeEditorSelection(selectedKey: key, candidates: rows, remappingKey: changing, remappingGroupIds: groups, contextMatches: current)
}
let current = [NativeEditorSelectionCandidate(key: "section:skills", groupIds: ["section-0"])]
precondition(resolve("section:skills", current) == "section:skills", "A stable selection should survive ordinary snapshots")
precondition(resolve("section:@0", current, "section:@0", ["section-0"]) == "section:skills", "The first native style/rename should preserve a legacy selection")
precondition(resolve("section:@0", current) == nil, "An unexplained positional replacement must not select another section")
precondition(resolve("section:removed", current, "section:removed", ["section-0"]) == nil, "Removed stable identities must not fall back to a position")
precondition(resolve("section:@0", current, "section:@1", ["section-0"]) == nil, "A different command's identity anchor is insufficient")
precondition(resolve("section:@0", current, "section:@0", []) == nil, "Empty group references cannot identify a legacy row")
precondition(resolve("section:@0", current + [NativeEditorSelectionCandidate(key: "section:duplicate", groupIds: ["section-0"])], "section:@0", ["section-0"]) == nil, "Ambiguous anchors must be refused")
precondition(resolve("section:skills", current, nil, [], false) == nil, "A changed workspace or adopted revision invalidates even a reused stable key")
precondition(resolve(nil, current) == nil, "No selection stays unselected")
print("navigation behavior passed")
`;
      const file = join(directory, 'main.swift');
      writeFileSync(file, program);
      const output = execFileSync('xcrun', ['swift', '-module-cache-path', join(directory, 'module-cache'), file], { encoding: 'utf8', timeout: 30_000 });
      expect(output).toContain('navigation behavior passed');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
