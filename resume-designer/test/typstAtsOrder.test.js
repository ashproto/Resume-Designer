import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelToTypst } from '../src/typst/generate.js';
import { buildTheme } from '../src/typst/theme.js';
import { flatToModel } from '../src/migrateToModel.js';

function typstAvailable() {
  try { execFileSync('typst', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

async function extractText(pdfPath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  let out = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    out += content.items.map((i) => i.str).join(' ') + ' ';
  }
  return out.replace(/\s+/g, ' ');
}

describe.skipIf(!typstAvailable())('ATS reading order (stacked)', () => {
  it('PDF text stream follows model reading order', async () => {
    const model = flatToModel({
      name: 'Ada Lovelace', tagline: 'Pioneer', contact: { email: 'ada@x.com' },
      summary: 'First programmer.',
      sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust', 'Go'] }],
      experience: [{ id: 'e', title: 'Collaborator', company: 'Analytical Engine', dates: '1842', bullets: ['Authored Note G.'] }],
    });
    const typ = modelToTypst(model, { theme: buildTheme({}) });
    const dir = mkdtempSync(join(tmpdir(), 'rd-ats-'));
    const typPath = join(dir, 'r.typ');
    const pdfPath = join(dir, 'r.pdf');
    writeFileSync(typPath, typ);
    execFileSync('typst', ['compile', typPath, pdfPath]);

    const text = await extractText(pdfPath);
    const order = ['Ada Lovelace', 'Skills', 'Rust', 'Experience', 'Collaborator', 'Note G'];
    const positions = order.map((tok) => ({ tok, at: text.indexOf(tok) }));
    for (const { tok, at } of positions) expect(at, `"${tok}" missing from PDF text`).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i].at, `"${positions[i].tok}" should follow "${positions[i - 1].tok}"`)
        .toBeGreaterThan(positions[i - 1].at);
    }
  });

  it('sidebar PDF text stream reads sidebar-then-main (not column-interleaved)', async () => {
    const model = flatToModel({
      name: 'Ada Lovelace', tagline: 'Pioneer', contact: { email: 'ada@x.com' },
      summary: 'First programmer.',
      sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust', 'Go'] }],
      experience: [{ id: 'e', title: 'Collaborator', company: 'Analytical Engine', dates: '1842', bullets: ['Authored Note G.'] }],
      tools: 'Figma',
    });
    const typ = modelToTypst(model, { theme: buildTheme({}), layout: 'sidebar' });
    const dir = mkdtempSync(join(tmpdir(), 'rd-ats-sb-'));
    const typPath = join(dir, 'r.typ'); const pdfPath = join(dir, 'r.pdf');
    writeFileSync(typPath, typ);
    execFileSync('typst', ['compile', typPath, pdfPath]);
    const text = await extractText(pdfPath);
    // #upper[...] renders sidebar titles as ALL-CAPS in the PDF stream.
    const order = ['Ada Lovelace', 'SKILLS', 'Rust', 'Summary', 'Experience', 'Collaborator'];
    const positions = order.map((tok) => ({ tok, at: text.indexOf(tok) }));
    for (const { tok, at } of positions) expect(at, `"${tok}" missing`).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i].at, `"${positions[i].tok}" should follow "${positions[i - 1].tok}"`).toBeGreaterThan(positions[i - 1].at);
    }
  });

  it('right-sidebar reads main-then-sidebar (not interleaved)', async () => {
    const model = flatToModel({ name: 'Ada Lovelace', tagline: 'Pioneer', contact: { email: 'ada@x.com' },
      summary: 'First programmer.', sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust', 'Go'] }],
      experience: [{ id: 'e', title: 'Collaborator', company: 'Analytical Engine', dates: '1842', bullets: ['Authored Note G.'] }], tools: 'Figma' });
    const typ = modelToTypst(model, { theme: buildTheme({}), layout: 'right-sidebar' });
    const dir = mkdtempSync(join(tmpdir(), 'rd-ats-rs-')); const typPath = join(dir, 'r.typ'); const pdfPath = join(dir, 'r.pdf');
    writeFileSync(typPath, typ); execFileSync('typst', ['compile', typPath, pdfPath]);
    const text = await extractText(pdfPath);
    const order = ['Ada Lovelace', 'Summary', 'Experience', 'Collaborator', 'SKILLS', 'Rust']; // sidebar titles are #upper -> uppercase in the PDF
    const pos = order.map((tok) => ({ tok, at: text.indexOf(tok) }));
    for (const { tok, at } of pos) expect(at, `"${tok}" missing`).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < pos.length; i++) expect(pos[i].at, `"${pos[i].tok}" after "${pos[i-1].tok}"`).toBeGreaterThan(pos[i-1].at);
  });

  it('modern reads sidebar-then-main (SKILLS/Rust before Summary/Experience)', async () => {
    const model = flatToModel({
      name: 'Ada Lovelace', tagline: 'Pioneer', contact: { email: 'ada@x.com' },
      summary: 'First programmer.',
      sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust', 'Go'] }],
      experience: [{ id: 'e', title: 'Collaborator', company: 'Analytical Engine', dates: '1842', bullets: ['Authored Note G.'] }],
      tools: 'Figma',
    });
    const typ = modelToTypst(model, { theme: buildTheme({}), layout: 'modern' });
    const dir = mkdtempSync(join(tmpdir(), 'rd-ats-mod-'));
    const typPath = join(dir, 'r.typ'); const pdfPath = join(dir, 'r.pdf');
    writeFileSync(typPath, typ);
    execFileSync('typst', ['compile', typPath, pdfPath]);
    const text = await extractText(pdfPath);
    // sidebar titles rendered with #upper[...] → appear UPPERCASE in the PDF text stream
    const order = ['Ada Lovelace', 'SKILLS', 'Rust', 'Summary', 'Experience', 'Collaborator'];
    const positions = order.map((tok) => ({ tok, at: text.indexOf(tok) }));
    for (const { tok, at } of positions) expect(at, `"${tok}" missing from PDF text`).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i].at, `"${positions[i].tok}" should follow "${positions[i - 1].tok}"`).toBeGreaterThan(positions[i - 1].at);
    }
  });

  it('compact reads main-then-sidebar (Summary/Experience before SKILLS/Rust)', async () => {
    const model = flatToModel({
      name: 'Ada Lovelace', tagline: 'Pioneer', contact: { email: 'ada@x.com' },
      summary: 'First programmer.',
      sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust', 'Go'] }],
      experience: [{ id: 'e', title: 'Collaborator', company: 'Analytical Engine', dates: '1842', bullets: ['Authored Note G.'] }],
      tools: 'Figma',
    });
    const typ = modelToTypst(model, { theme: buildTheme({}), layout: 'compact' });
    const dir = mkdtempSync(join(tmpdir(), 'rd-ats-cmp-'));
    const typPath = join(dir, 'r.typ'); const pdfPath = join(dir, 'r.pdf');
    writeFileSync(typPath, typ);
    execFileSync('typst', ['compile', typPath, pdfPath]);
    const text = await extractText(pdfPath);
    // compact: main-left (emitted first) → main section titles appear before sidebar titles
    // sidebar titles use #upper[...] → appear UPPERCASE in PDF text stream
    const order = ['Ada Lovelace', 'Summary', 'Experience', 'Collaborator', 'SKILLS', 'Rust'];
    const positions = order.map((tok) => ({ tok, at: text.indexOf(tok) }));
    for (const { tok, at } of positions) expect(at, `"${tok}" missing from PDF text`).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i].at, `"${positions[i].tok}" should follow "${positions[i - 1].tok}"`).toBeGreaterThan(positions[i - 1].at);
    }
  });

  it('executive reads: summary → main experience → side sections', async () => {
    const model = flatToModel({
      name: 'Ada Lovelace', tagline: 'Pioneer', contact: { email: 'ada@x.com' },
      summary: 'First programmer.',
      sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust', 'Go'] }],
      experience: [{ id: 'e', title: 'Collaborator', company: 'Analytical Engine', dates: '1842', bullets: ['Authored Note G.'] }],
      tools: 'Figma',
    });
    const typ = modelToTypst(model, { theme: buildTheme({}), layout: 'executive' });
    const dir = mkdtempSync(join(tmpdir(), 'rd-ats-exec-'));
    const typPath = join(dir, 'r.typ'); const pdfPath = join(dir, 'r.pdf');
    writeFileSync(typPath, typ);
    execFileSync('typst', ['compile', typPath, pdfPath]);
    const text = await extractText(pdfPath);
    // Order: name → pulled-out summary → main (Professional Experience → Collaborator) → side (SKILLS uppercase)
    const order = ['Ada Lovelace', 'First programmer', 'Professional Experience', 'Collaborator', 'SKILLS'];
    const positions = order.map((tok) => ({ tok, at: text.indexOf(tok) }));
    for (const { tok, at } of positions) expect(at, `"${tok}" missing from PDF text`).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i].at, `"${positions[i].tok}" should follow "${positions[i - 1].tok}"`).toBeGreaterThan(positions[i - 1].at);
    }
  });
});
