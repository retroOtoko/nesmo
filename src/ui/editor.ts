// CodeMirror 6 editor with ca65 highlighting, a breakpoint gutter, the
// current-PC line, build errors and completions. Each file keeps its own
// EditorState so undo history survives switching files.
import {
  EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter,
  drawSelection, gutter, GutterMarker, Decoration, type DecorationSet,
} from '@codemirror/view';
import { EditorState, StateEffect, StateField, RangeSet, type Extension } from '@codemirror/state';
import { StreamLanguage, indentUnit, bracketMatching } from '@codemirror/language';
import { defaultKeymap, history, historyKeymap, indentWithTab, toggleComment } from '@codemirror/commands';
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import { autocompletion, completionKeymap, type CompletionContext, type Completion } from '@codemirror/autocomplete';
import { setDiagnostics, type Diagnostic } from '@codemirror/lint';
import { oneDark } from '@codemirror/theme-one-dark';
import { app } from '../app';
import { MNEMONICS } from '../cpu6502/opcodes';
import { isText } from '../project/store';
import type { BuildMessage } from '../toolchain/build';
import { h, isPhone } from './dom';

// ---------------------------------------------------------------- language
const MNEM_SET = new Set(Object.keys(MNEMONICS).map((m) => m.toLowerCase()));
const ca65 = StreamLanguage.define({
  name: 'ca65',
  token(stream) {
    if (stream.eatSpace()) return null;
    const ch = stream.peek();
    if (ch === ';') {
      stream.skipToEnd();
      return 'comment';
    }
    if (stream.match(/^"(?:[^"\\]|\\.)*"?/)) return 'string';
    if (stream.match(/^'.'/)) return 'string';
    if (stream.match(/^\$[0-9a-fA-F]+/) || stream.match(/^%[01]+/) || stream.match(/^\d+/)) return 'number';
    if (stream.match(/^\.[a-zA-Z_]\w*/)) return 'meta';
    if (stream.match(/^@?[a-zA-Z_]\w*:/)) return 'labelName';
    if (stream.match(/^@?[a-zA-Z_]\w*/)) {
      const w = stream.current().toLowerCase();
      if (MNEM_SET.has(w)) return 'keyword';
      if (w === 'x' || w === 'y' || w === 'a') return 'atom';
      return 'variableName';
    }
    if (stream.match(/^[#<>]/)) return 'operator';
    stream.next();
    return null;
  },
  languageData: { commentTokens: { line: ';' } },
});

const DIRECTIVES = [
  '.segment', '.byte', '.word', '.addr', '.res', '.include', '.incbin', '.proc', '.endproc',
  '.import', '.export', '.importzp', '.exportzp', '.scope', '.endscope', '.macro', '.endmacro',
  '.if', '.else', '.endif', '.ifdef', '.ifndef', '.repeat', '.endrepeat', '.define', '.enum',
  '.endenum', '.struct', '.endstruct', '.lobytes', '.hibytes', '.dbyt', '.asciiz', '.org', '.align',
];

function projectSymbols(): Completion[] {
  const seen = new Set<string>();
  const out: Completion[] = [];
  for (const [name, data] of Object.entries(app.project.files)) {
    if (typeof data !== 'string') continue;
    for (const m of data.matchAll(/^\s*(?:\.proc\s+)?([a-zA-Z_]\w*)(?::|\s*=)/gm)) {
      if (seen.has(m[1]) || MNEM_SET.has(m[1].toLowerCase())) continue;
      seen.add(m[1]);
      out.push({ label: m[1], type: 'variable', detail: name });
    }
  }
  return out;
}

function completions(ctx: CompletionContext) {
  const word = ctx.matchBefore(/[.@\w]+/);
  if (!word || (word.from === word.to && !ctx.explicit)) return null;
  const opts: Completion[] = [];
  if (word.text.startsWith('.')) {
    for (const d of DIRECTIVES) opts.push({ label: d, type: 'keyword' });
  } else {
    for (const [m, info] of Object.entries(MNEMONICS)) opts.push({ label: m, type: 'keyword', detail: info.name });
    opts.push(...projectSymbols());
  }
  return { from: word.from, options: opts, validFor: /^[.@\w]*$/ };
}

// ------------------------------------------------------------- breakpoints
class BpMarker extends GutterMarker {
  toDOM() {
    return h('span', { class: 'bp-dot' });
  }
}
const bpMarker = new BpMarker();
const setBreakpointsEffect = StateEffect.define<number[]>(); // line numbers

const breakpointField = StateField.define<RangeSet<GutterMarker>>({
  create: () => RangeSet.empty,
  update(set, tr) {
    set = set.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setBreakpointsEffect)) {
        const doc = tr.state.doc;
        const ranges = e.value
          .filter((l) => l >= 1 && l <= doc.lines)
          .sort((a, b) => a - b)
          .map((l) => bpMarker.range(doc.line(l).from));
        set = RangeSet.of(ranges, true);
      }
    }
    return set;
  },
});

function breakpointLines(state: EditorState): number[] {
  const lines: number[] = [];
  const iter = state.field(breakpointField).iter();
  while (iter.value) {
    lines.push(state.doc.lineAt(iter.from).number);
    iter.next();
  }
  return [...new Set(lines)];
}

// ------------------------------------------------------------ current line
const setPcEffect = StateEffect.define<number | null>();
const pcField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setPcEffect)) {
        if (e.value === null || e.value > tr.state.doc.lines) deco = Decoration.none;
        else deco = Decoration.set([Decoration.line({ class: 'cm-pc-line' }).range(tr.state.doc.line(e.value).from)]);
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});

// ------------------------------------------------------------------ editor
export class CodeEditor {
  view: EditorView;
  file = '';
  private states = new Map<string, EditorState>();
  private pc: { file: string; line: number } | null = null;
  private messages: BuildMessage[] = [];
  onBuild: () => void = () => {};

  constructor(parent: HTMLElement) {
    this.view = new EditorView({ parent, state: EditorState.create({ doc: '', extensions: this.extensions('') }) });
  }

  private extensions(file: string): Extension[] {
    const toggleBp = (view: EditorView, pos: number) => {
      const line = view.state.doc.lineAt(pos).number;
      const lines = breakpointLines(view.state);
      const next = lines.includes(line) ? lines.filter((l) => l !== line) : [...lines, line];
      view.dispatch({ effects: setBreakpointsEffect.of(next) });
      app.setFileBreakpoints(this.file, next);
      return true;
    };
    return [
      lineNumbers({ domEventHandlers: { mousedown: (view, line) => toggleBp(view, line.from) } }),
      gutter({
        class: 'cm-bp-gutter',
        markers: (v) => v.state.field(breakpointField),
        initialSpacer: () => bpMarker,
        domEventHandlers: { mousedown: (view, line) => toggleBp(view, line.from) },
      }),
      breakpointField,
      pcField,
      highlightActiveLineGutter(),
      highlightActiveLine(),
      history(),
      drawSelection(),
      bracketMatching(),
      highlightSelectionMatches(),
      indentUnit.of('  '),
      EditorState.tabSize.of(8),
      isText(file) ? ca65 : [],
      isPhone() ? EditorView.lineWrapping : [],
      oneDark,
      autocompletion({ override: [completions], icons: false }),
      keymap.of([
        { key: 'Mod-Enter', run: () => (this.onBuild(), true) },
        { key: 'Mod-b', run: () => (this.onBuild(), true) },
        { key: 'Mod-/', run: toggleComment },
        indentWithTab,
        ...completionKeymap,
        ...defaultKeymap,
        ...historyKeymap,
        ...searchKeymap,
      ]),
      EditorView.updateListener.of((u) => {
        if (u.docChanged && this.file) {
          app.setFile(this.file, u.state.doc.toString(), { silent: true });
          const lines = breakpointLines(u.state);
          const stored = app.project.breakpoints.filter((b) => b.startsWith(this.file + ':')).length;
          if (lines.length || stored) app.setFileBreakpoints(this.file, lines);
        }
      }),
      EditorView.theme({
        '&': { height: '100%' },
        '.cm-scroller': { fontFamily: 'var(--mono)', lineHeight: '1.5' },
      }),
    ];
  }

  open(file: string) {
    if (this.file) this.states.set(this.file, this.view.state);
    this.file = file;
    const data = app.project.files[file];
    if (typeof data !== 'string') {
      this.view.setState(EditorState.create({ doc: data ? `; ${file} is a binary file (${data.length} bytes).\n; Open the CHR tab to edit graphics.` : '', extensions: [oneDark, EditorState.readOnly.of(true), lineNumbers()] }));
      return;
    }
    let state = this.states.get(file);
    if (!state || state.doc.toString() !== data) {
      state = EditorState.create({ doc: data, extensions: this.extensions(file) });
    }
    this.view.setState(state);
    const lines = app.project.breakpoints
      .filter((b) => b.startsWith(file + ':'))
      .map((b) => parseInt(b.slice(file.length + 1), 10));
    this.view.dispatch({ effects: [setBreakpointsEffect.of(lines), setPcEffect.of(this.pc?.file === file ? this.pc.line : null)] });
    this.applyDiagnostics();
  }

  /** Forget cached states (after switching projects). */
  reset() {
    this.states.clear();
    this.file = '';
  }

  refreshBreakpoints() {
    if (!this.file) return;
    const lines = app.project.breakpoints
      .filter((b) => b.startsWith(this.file + ':'))
      .map((b) => parseInt(b.slice(this.file.length + 1), 10));
    const current = breakpointLines(this.view.state);
    if (lines.length !== current.length || lines.some((l) => !current.includes(l))) {
      this.view.dispatch({ effects: setBreakpointsEffect.of(lines) });
    }
  }

  setMessages(msgs: BuildMessage[]) {
    this.messages = msgs;
    this.applyDiagnostics();
  }

  private applyDiagnostics() {
    const doc = this.view.state.doc;
    const diags: Diagnostic[] = this.messages
      .filter((m) => m.file === this.file && m.line > 0 && m.line <= doc.lines)
      .map((m) => {
        const line = doc.line(m.line);
        return { from: line.from, to: Math.max(line.to, line.from), severity: m.severity, message: m.text };
      });
    this.view.dispatch(setDiagnostics(this.view.state, diags));
  }

  setPc(loc: { file: string; line: number } | null) {
    this.pc = loc;
    if (loc && loc.file !== this.file) return;
    this.view.dispatch({ effects: setPcEffect.of(loc ? loc.line : null) });
  }

  reveal(line: number, select = true) {
    const doc = this.view.state.doc;
    if (line < 1 || line > doc.lines) return;
    const l = doc.line(line);
    this.view.dispatch({
      selection: select ? { anchor: l.from } : undefined,
      effects: EditorView.scrollIntoView(l.from, { y: 'center' }),
    });
  }

  insert(text: string) {
    const v = this.view;
    if (v.state.readOnly) return;
    v.dispatch(v.state.replaceSelection(text));
    v.focus();
  }

  moveCursor(delta: number) {
    const v = this.view;
    const pos = Math.max(0, Math.min(v.state.doc.length, v.state.selection.main.head + delta));
    v.dispatch({ selection: { anchor: pos } });
    v.focus();
  }
}
