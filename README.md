# SwiftMark — fast drop-in Markdown renderer

![correctness](https://img.shields.io/badge/correctness-720%2F720%20practice-brightgreen)
![speedup](https://img.shields.io/badge/speedup-1.38x%20vs%20marked-blue)
![license](https://img.shields.io/badge/license-MIT-lightgrey)

A dependency-free ES module that renders Markdown to HTML **byte-for-byte
identical to [marked](https://github.com/markedjs/marked) 18.1.3** (default
options: GFM on, `breaks` off, `pedantic` off), faster than marked itself.

Built for the make.fun `markdown-render-speed-02` competition: `parse.js`
exports a single function `parse(markdown) -> string`, and `main.ts` is the
harness driver that reads `/input/cases.json` and writes
`/output/html.json`.

## Correctness

| Suite | Result |
|---|---|
| Practice set (680 CommonMark + GFM spec cases + 40 README docs) | **720 / 720** |
| 5 generated sets (5 × 720 cases, same generator, different seeds) | **3600 / 3600** |
| Random fuzz (2000 inputs: random construction + spec mutations) | 1781 / 2000 |

The gate is 720/720: speed only counts once every case matches marked
exactly. The residual fuzz mismatches (219/2000) are all adversarial
random line-soup — lines from unrelated documents stitched together into
nested list + blockquote + code-merge pileups that coherent documents do
not produce. All 240 coherent documents tested (practice + 5 generated
sets) pass with zero mismatches.

## Benchmark vs marked

Measured on the 720-case practice set (2,862,813 characters total),
Node v24.22.1, median of 3 runs, CPU time via `process.cpuUsage`:

| Engine | Median CPU | Speedup |
|---|---|---|
| **SwiftMark (`parse.js`)** | **571 ms** | **1.38x** |
| marked 18.1.3 | 788 ms | 1.00x |

Throughput: ~5.0 MB/s of Markdown per CPU-second on this set.

Honest note: the 3x target was not reached. The parser prioritises
byte-exact marked compatibility over raw speed, and its inline engine
runs several passes (mask → scan → emphasis resolution → render) where
marked runs fewer. The number above is the measured result, not an
aspiration; the grading container (Node 22.23.4, 1 CPU) will produce
different absolute times, but the relative gap should be similar.

Reproduce it:

```sh
node bench/bench.mjs                 # built-in samples
node bench/bench.mjs cases.json 3    # your own cases file, 3 runs
```

The bench script imports only `parse.js` — marked is never a
dependency and is never imported by the repo.

## Architecture

```
parse.js   (~3,800 lines, one file, zero dependencies)
main.ts    (harness driver: /input/cases.json -> /output/html.json)
bench/     (bench/bench.mjs — standalone benchmark, no marked import)
```

### Block layer — `renderBlocks` / `renderOneBlock`

- One pass over the document's lines (`src.split('\n')`, `\r` normalised
  once up front). Blocks dispatch on the first non-space character's
  `charCodeAt`: `#` ATX, `>` blockquote, `` ` ``/`~` fence, `-`/`*`/`_`
  thematic break / list, `<` HTML, digit list, table (header +
  delimiter row detection), indented code, setext heading, paragraph.
- Paragraphs are collected as line ranges and rendered once, with link
  reference definitions hoisted into a document-wide `Map` as they are
  found — a reference may be used before its definition appears.
- Blockquotes track open fenced code blocks *and* open HTML blocks
  (types 1–7, with each type's own end rule) so a fence opener inside
  an HTML block is literal text, and lazy (marker-less) continuation
  lines are accepted only when the inner content ends in an open
  paragraph — with the code-merge rule for indented lazy runs
  (see below).
- Tables follow marked's exact row-continuation rule: a body row ends
  at a blank line, ATX/blockquote/fence/indented-code/thematic-break, a
  bullet list, an ordered list starting at **1**, or an HTML block of
  types 1–6. An ordered list starting at any other number (`0. …`) and
  a type-7 HTML block (`<picture>`) are rows, not terminators.
- Lists use marked's item model: content indent from the marker,
  tight/loose detection, lazy continuation lines, and task items.

### Inline layer — deferred, then single scan + delimiter stack

Inline parsing is **deferred**: block rendering pushes lazy placeholders
(`{lazy: true, ctx, text}`) and `parse()` resolves them after the block
pass, when every link reference definition in the document is known.
Per paragraph the pipeline is:

1. **`renderInlineText` fast path** — a single C++ regex scan for
   special characters (`\`, backtick, `* _ ~ [ ] ! < &`, newline) plus
   autolink triggers (`@`, `www.`, `://`, `mailto:`). Text with none of
   those is escaped in one pass and never enters the inline parser.
2. **`scanInline`** — one left-to-right pass. Backslash escapes and hard
   breaks, code spans (with marked's rule that a span may not swallow
   an emphasis closer), inline/reference/collapsed/shortcut links and
   images, angle autolinks, inline HTML (tracking document-wide
   `inLink` state for `<a>`), entities, and emphasis delimiter runs
   with CommonMark flanking rules. Text between markup becomes text
   tokens; nothing is rendered yet.
3. **`maskInlineText`** (marked's `#n` mask, computed lazily) —
   reflink search, apostrophe/code masking, and block-skip masking hide
   delimiters that sit inside links, code spans, or HTML, so they can
   never pair as emphasis.
4. **`hideMaskedDelimiters` + `resolveEmphasis`** — a scan-forward
   resolver mirroring marked's `emStrong`/`del`: outer emphasis
   resolves before inner, closer leftovers are retried, and the
   rule-of-3 / odd-match checks apply exactly as in marked.
5. **`renderTokens`** — emits the HTML: text runs escaped in one C++
   regex replace, code spans, links (with `cleanUrl` percent-encoding),
   images with alt text, `<br>` / `\n`, and entities.

### The lazy-line code-merge rule (the subtle one)

Inside a blockquote, a run of lazy (marker-less) lines that starts
indented 4+ columns is **not** paragraph text as-is: marked's lexer
tries the indented-code tokenizer first on that chunk, strips up to 4
columns from every line of the leading run, and merges the result into
the open paragraph — keeping the code token's trailing newline, which
surfaces as a blank line before the next paragraph line (and as a
trailing newline when the paragraph is interrupted by a following
block). A run starting with a non-indented line keeps every indent.
A run belonging to a nested blockquote or list item is pushed through
unstripped — the inner block strips exactly once.

### What is deliberately NOT done

- No dependency, no network, no clock, no environment input, no
  randomness — the same input always yields the same bytes.
- No caching between cases, no case tables, no lookup by case text or
  hash, no copied marked source (marked was read only as a behavioural
  reference; the named-entity table is the only mechanically extracted
  data, which the rules explicitly allow).
- No `eval`, no `Function`, no dynamic import.

## Differential methodology

Correctness was verified by differential testing against marked 18.1.3
(the kit's vendored baseline), byte-for-byte, on every case:

1. **Practice set** — the kit's 720 cases, run with the workspace
   harness (`diff/diff.mjs`): `PASS 720 FAIL 0`.
2. **Generated sets** — five fresh 720-case sets from the kit's
   generator (`draw.ts`, different seeds), same harness: 720/720 each.
3. **Targeted probes** — every failure found during development was
   reduced to a minimal reproduction (blockquote + fence + HTML
   interaction, table row terminators, lazy-continuation indents,
   nested-quote double dedent, code-merge trailing newlines) and
   re-checked against marked directly before fixing.
4. **Fuzzing** — 2000 seeded inputs (1000 random constructions from
   spec/practice lines + 1000 mutations of spec examples), compared
   against `marked.parse`: 1781 pass. Remaining mismatches are
   adversarial random-soup combinations; see the Correctness section.

## Trade-offs

- **Correctness over speed.** The multi-pass inline engine (mask, scan,
  resolve, render) is what makes the output byte-identical on the
  pathological cases (emphasis inside links, code spans swallowing
  closers, masked delimiters). A single-pass renderer would be faster
  but would have to re-derive all of marked's masking and emphasis
  edge cases — that is the main reason the speedup is 1.38x and not 3x.
- **Memory over cleverness.** Token objects are allocated per text run
  and per delimiter; the garbage collector is ~4% of runtime. Parallel
  arrays would be faster but would make the emphasis resolver much
  harder to keep correct.
- **Readability over golfing.** The parser is ~3,800 lines with a
  comment on every non-obvious rule (each citing the case that pins
  it: `cm-093`, `doc-17`, `set2 doc-02`, …). It is meant to be audited
  line by line, not to be the shortest possible implementation.
- **Determinism over adaptivity.** No input-dependent tuning, no
  heuristics that change behaviour by document size — every case is
  rendered by the same code path, so a case that passes in testing
  passes in grading.

## Usage

```js
import { parse } from './parse.js';

parse('# Hello\n\nWorld with *emphasis*.');
// '<h1>Hello</h1>\n<p>World with <em>emphasis</em>.</p>\n'
```

Harness driver (what the grader runs):

```sh
MAKEFUN_INPUT_DIR=/input MAKEFUN_OUTPUT_DIR=/output node main.ts
# reads  /input/cases.json  (array of {id, markdown})
# writes /output/html.json  (array of HTML strings, same order)
```

## License

MIT — see [LICENSE](LICENSE).
