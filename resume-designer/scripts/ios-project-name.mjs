import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Xcode Cloud discovers PBXNativeTarget.name. Keep XcodeGen's legacy target
// identity and scheme: Tauri 2.11.2 locates signing/build configurations by
// the `_iOS` marker in XCConfigurationList comments, not by the target ID.
// Xcode rewrites those comments on save, so restore them before local Tauri
// invocations as well as branding the target after each generation.
export function brandIosTarget(project, scheme) {
  const section = project.match(/\/\* Begin PBXNativeTarget section \*\/[\s\S]*?\/\* End PBXNativeTarget section \*\//)?.[0];
  const targets = [...(section || '').matchAll(/^\t\t([A-F0-9]+) \/\* .*? \*\/ = \{\n[\s\S]*?^\t\t\};/gm)]
    .filter(match => /^\t\t\tname = "(?:resume-designer_iOS|On Paper)";$/m.test(match[0]));
  if (targets.length !== 1) throw new Error('Expected exactly one On Paper iOS target');
  const [target, targetId] = targets[0];
  const configId = target.match(/buildConfigurationList = ([A-F0-9]+) /)?.[1];
  const configSection = project.match(/\/\* Begin XCConfigurationList section \*\/[\s\S]*?\/\* End XCConfigurationList section \*\//)?.[0] || '';
  const configLabel = 'Build configuration list for PBXNativeTarget "(?:resume-designer_iOS|On Paper)"';
  if (!configId || !new RegExp(`^\\t\\t${configId} /\\* ${configLabel} \\*/ = \\{`, 'm').test(configSection)) {
    throw new Error('Missing Tauri iOS configuration marker; review the generator/CLI compatibility');
  }

  let references = 0;
  const brandedScheme = scheme.replace(/<BuildableReference\b[\s\S]*?<\/BuildableReference>/g, reference => {
    if (!reference.includes(`BlueprintIdentifier = "${targetId}"`)) return reference;
    if (!/BlueprintName = "(?:resume-designer_iOS|On Paper)"/.test(reference)) {
      throw new Error('Unexpected iOS scheme target name');
    }
    references++;
    return reference.replace(/BlueprintName = "(?:resume-designer_iOS|On Paper)"/, 'BlueprintName = "On Paper"');
  });
  if (!references) throw new Error('The legacy shared scheme does not reference the iOS target');
  const brandedTarget = target.replace(/^\t\t\tname = "(?:resume-designer_iOS|On Paper)";$/m, '\t\t\tname = "On Paper";');
  // Follow the target's configuration-list UUID. Never rewrite comments for
  // another target or regenerate away settings saved through Xcode.
  const brandedProject = project.replace(target, brandedTarget).replace(
    new RegExp(`${configId} /\\* ${configLabel} \\*/`, 'g'),
    `${configId} /* Build configuration list for PBXNativeTarget "resume-designer_iOS" */`,
  );
  return { project: brandedProject, scheme: brandedScheme };
}

export function prepareIosProject(projectPath) {
  const projectFile = join(projectPath, 'project.pbxproj');
  const schemeFile = join(projectPath, 'xcshareddata/xcschemes/resume-designer_iOS.xcscheme');
  const project = readFileSync(projectFile, 'utf8');
  const scheme = readFileSync(schemeFile, 'utf8');
  // Validate both files before writing either; fail visibly if the generator
  // changes its contract instead of silently losing local signing behavior.
  const branded = brandIosTarget(project, scheme);
  if (branded.project !== project) writeFileSync(projectFile, branded.project);
  if (branded.scheme !== scheme) writeFileSync(schemeFile, branded.scheme);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { prepareIosProject(resolve(process.argv[2] || 'resume-designer.xcodeproj')); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
