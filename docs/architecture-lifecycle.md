# Voyager document lifecycle (single persistent document)

## One persistent document, populated in place

`CVDocumentProvider` owns exactly one `CVDocument`. It is created **empty and
synchronously** when the application is constructed (`ensureDocument()`); no
placeholder scene is loaded into it.

Loading a scene **repopulates that same document in place** via
`provider.openDocument(data)` → `CVDocument.openDocument`, which clears the
previous models/cameras/lights and deserializes the new ones. The root
`NVScene`, its `CVSetup`, and the viewer/navigation/etc. component instances are
preserved, so the document object is stable for the element's lifetime and is
never swapped.

There is **no document merging**: `openDocument` always replaces the scene
content (the previous `amendDocument` / `merge` heuristic is removed). The
default template (`templates/default.svx.json`) is loaded into the persistent
document only when there is nothing else to show (standalone mode) or to host a
raw `model`/`geometry`.

A provided `document` is therefore the first and only *content* ever loaded into
the viewer; the empty document that precedes it carries no scene of its own (the
renderer falls back to a default camera until real content arrives, behind the
loading spinner).

## Lifecycle state — "interactable", not "fully loaded"

`CVDocumentProvider.outs.state` exposes an `EDocumentState`
(`source/client/schema/document.ts`), driven **explicitly** by the load methods
(`setLoading()` / `setReady()` / `setError()`) rather than inferred from
asset-manager flags:

| State          | Meaning                                                        |
|----------------|----------------------------------------------------------------|
| `Loading`      | A document/model load is in flight (fetch / parse / build).    |
| `Ready`        | The scene graph is built and the viewer is **interactable**. An empty/default scene is `Ready`. |
| `Error`        | The last load failed.                                          |

(There is no separate "initializing" state: the persistent document is created
synchronously at startup, before any consumer can observe the viewer, so the
state is always one of the three above.)

The important design decision: **`Ready` is orthogonal to model derivative
quality.** It means "the scene graph exists and the viewer is navigable", not
"all models have reached target quality". Individual models stream their
derivatives (thumb → full) independently, and that progress is reported through
a *separate* channel that this change leaves untouched:

- per-derivative `model-load` events, and
- the viewer's `sceneLoaded` output / loading spinner.

Keeping these two axes separate means:

- "Is the scene interactable yet?" is answered by the lifecycle state
  (`scene-ready` / `document-state`), reliably and independently of network idle
  or LOD streaming.
- "Are all models at target quality?" remains a property of the asset layer,
  where quality thresholds (e.g. thumb-is-loading vs. thumb-is-loaded) and
  load-time analytics can be defined without touching the lifecycle state.

## Consuming the contract

On the `<voyager-explorer>` element:

- `getState()` returns the current state name.
- DOM `CustomEvent`s: `load-start`, `load-end`, `scene-ready`, `document-state`
  (`detail` = state name), alongside the existing per-derivative `model-load`.

```js
const el = document.querySelector("voyager-explorer");
el.addEventListener("scene-ready", () => console.log("interactable:", el.getState()));
```
