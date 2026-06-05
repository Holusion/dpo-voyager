# Voyager document loading semantics

This describes the viewer's document lifecycle state and how it is surfaced to
API consumers. It is intentionally independent of *how* documents are created or
replaced internally.

## Lifecycle state — "interactable", not "fully loaded"

`CVDocumentProvider.outs.state` exposes an `EDocumentState`
(`source/client/schema/document.ts`), driven **explicitly** by the application
load methods (`setLoading()` / `setReady()` / `setError()`) rather than inferred
from asset-manager flags:

| State     | Meaning                                                            |
|-----------|--------------------------------------------------------------------|
| `Loading` | A document/model load is in flight (fetch / parse / build).        |
| `Ready`   | The scene graph is built and the viewer is **interactable**. An empty/default scene is `Ready`. |
| `Error`   | The last load failed.                                              |

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
  load-time-to-full-quality analytics can be defined without touching the
  lifecycle state.

There is no separate "initializing" state: a document exists by the time any
consumer can observe the viewer, so the state is always one of the three above.

## Consuming the contract

On the `<voyager-explorer>` element:

- `getState()` returns the current state name (`"Loading" | "Ready" | "Error"`).
- DOM `CustomEvent`s: `load-start`, `load-end`, `scene-ready`, `document-state`
  (`detail` = state name), alongside the existing per-derivative `model-load`.

```js
const el = document.querySelector("voyager-explorer");
el.addEventListener("scene-ready", () => console.log("interactable:", el.getState()));
```
