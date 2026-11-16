// SwiftMark driver — make.fun markdown-render-speed-02.
//
// Reads /input/cases.json (an array of {id, markdown}), renders each
// case on its own with parse() from ./parse.js, and writes
// /output/html.json (an array of the HTML strings, same order).
// Outside a container, MAKEFUN_INPUT_DIR and MAKEFUN_OUTPUT_DIR
// stand in for /input and /output. Pure driver: no clock, no
// randomness, no other environment input — the same input always
// yields the same bytes. Each case is rendered independently (no
// state carries between cases), so output order always matches
// input order.
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parse } from './parse.js';

const inputDir = process.env.MAKEFUN_INPUT_DIR ?? '/input';
const outputDir = process.env.MAKEFUN_OUTPUT_DIR ?? '/output';

const cases = JSON.parse(readFileSync(join(inputDir, 'cases.json'), 'utf8'));
const html = cases.map((c) => parse(c.markdown));
writeFileSync(join(outputDir, 'html.json'), JSON.stringify(html));
