import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import type { SwitchCatalogEntry } from '../types/ipc.js';

// Loaded via fs.readFileSync (not `import ... with { type: 'json' }`) so it
// doesn't require bumping the project's tsconfig `module` target just for
// this one file — plain JSON-as-text works under any module setting and
// resolves correctly next to the compiled .js both in dev and once packaged.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const catalogPath = path.join(__dirname, 'switchCatalog.json');
const catalog: SwitchCatalogEntry[] = JSON.parse(fs.readFileSync(catalogPath, 'utf-8'));

// Matches against the already-formatted model string (e.g.
// "ProCurve 2510G-24 (J9279A)" from ProCurveParser.parseModelFromBanner),
// which contains both the marketing name and the J-number, so a pattern on
// either one is enough. Patterns are deliberately narrow (exact J-number or
// model string) rather than broad families — we only mark an entry "tested"
// for the specific unit/firmware combination actually verified live, not
// every switch that happens to share a product line name.
export function matchSwitchCatalog(model?: string): SwitchCatalogEntry | undefined {
  if (!model) return undefined;
  return catalog.find((entry) => new RegExp(entry.modelPattern, 'i').test(model));
}
