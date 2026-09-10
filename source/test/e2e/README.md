# Browser acceptance drivers for the edit journal

Not part of any test run and not in git (`source/test/` is ignored): these are
the scripts the undo work was developed against. They drive the real story tool
in a real browser, because the thing under test is the graph's own change
propagation, which no unit test reproduces.

The unit tests that *are* in the repo cover the journal in isolation:

    cd source/test && npx webpack && npx mocha build/test/EditJournal.test.js build/test/describeEdit.test.js

## Running

    npm run build-dev                 # dist/ must match the source under test
    node source/test/e2e/serve.js &   # static server on :8099, serves dist/ and files/
    node source/test/e2e/undo-drive.js "Mausolée_Seclin"

The scene name is a directory under `files/`, expected to contain
`scene.svx.json`. Available here: `Mausolée_Seclin`, `Seclin_BasRelief`,
`Eglise_Seclin`, `Fontaine_Seclin` (the heaviest, and the one still untested).

Needs `playwright` (already a dev dependency) with its browsers installed:
`npx playwright install chromium`.

Headless Chromium in this container runs the render loop at roughly 0.5 fps, so
a full `undo-drive.js` pass takes several minutes and most of that is waiting.
The settle waits (`settle()`, 250 ms) are the knob to turn if you run it
somewhere with a compositor.

## What each script does

| script | what it is for |
| --- | --- |
| `undo-drive.js` | the acceptance run: one scenario per editable property, then multi-edit and non-edit oracles |
| `perf-drive.js` | what edit detection costs, per graph tick, in four phases (idle, slider drag, gizmo drag, undo) |
| `inventory.js` | dumps every component and tracked property of a loaded scene - how the scenario list was written |
| `busy-probe3.js` | balance of the loading manager's itemStart/itemEnd, with the asset CDN blocked |
| `unpersisted-probe.js` | which properties mark the document unsaved without being part of what a save writes |
| `serve.js` | the static server the others expect on :8099 |

## How undo-drive.js judges a scenario

For each `[name, component type, property path, value]` row:

1. resets the journal and the save point, then snapshots **every** tracked
   property in the document;
2. writes the value the way `PropertyField` does - through `property.value`
   then `set()` - so the shadow-copy path is exercised, not a clean `setValue`;
3. asserts the document went dirty, and that the change was journalled rather
   than counted as unjournaled;
4. presses undo until the document reads clean, then diffs the whole snapshot:
   the property must be back, and **nothing else** may have moved;
5. presses redo to the end and asserts the edited state and the dirty flag both
   come back.

The scenario line also prints the entry count, the number of undo presses it
took, and the title the undo button would have shown.

Camera pose, the transforms navigation drives, and `Reader.Focus` are excluded
from the snapshot diff (`viewState`) because the journal deliberately does not
take view state back. That exclusion is a design decision, not a workaround -
if undo should move the camera, that regex is where the test would change.

### Known gaps in the coverage

- **Annotations are not covered at all.** They are structural change, which the
  property hook cannot see; editing one does not currently mark the document
  unsaved either.
- **Gesture boundaries cannot be tested from here.** Coalescing keys off
  pointer and key events; a script writing properties directly never produces
  them, so `commitEdit()` is called explicitly instead. Whether one human drag
  reads as one undo is the one thing this harness structurally cannot answer.
- One scenario in twelve still gets swallowed when it lands inside a load
  cascade (see the multi-edit oracle: 12 edits, 8 entries).
- Only two of the four scenes have been through a full pass.
