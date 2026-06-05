# Voyager internal state & document lifecycle

This document describes the contract Voyager exposes about its own internal
state: when it is initializing, when a document is loading, when the scene graph
is interactable, and the difference between *system* components and *scene-graph*
components.

## System components vs. scene-graph components

Voyager is built on the `@ff/graph` entity-component-system. Components live in
one of two places:

- **System components** are document-independent. They are created once, in the
  application constructor, on the system graph (`system.graph`) via the
  `NVEngine`, `NVTools` and `NVDocuments` nodes. Examples: `CPulse`,
  `CRenderer`, `CFullscreen`, `CVAssetManager`, `CVAssetReader`, `CVAnalytics`,
  `CVARManager`, `CPickSelection`, `CVDocumentProvider`. They **outlive every
  document**. The document-independent Voyager components are marked with
  `static readonly isSystemSingleton = true`, so "is this a system component?"
  is answerable programmatically.

- **Scene-graph components** are per-document. They live exclusively inside
  `CVDocument.innerGraph`: the root `NVScene` node (holding `CVScene`,
  `CVSetup`, `CVMeta`) and the `NVNode` sub-tree (holding `CVModel2`,
  `CVCamera`, `CLight`, ...). They are **created and destroyed with each
  document**.

> **Rule:** never hold a reference to a scene-graph component across a
> `createDocument` call. After a document switch, the previous document and all
> of its components are disposed.

## The single document path: `createDocument`

`CVDocumentProvider.createDocument(data?, path?)` is the single entry point for
showing a scene. It:

1. constructs a brand-new `CVDocument` (inactive and hidden, so it is never
   rendered or ticked while half-built),
2. populates its scene graph from `data` (if given) via
   `CVDocument.openDocument`,
3. atomically swaps it in as the active document (deactivating the previous one),
4. disposes the previous document — and its entire inner graph — last.

There is **no document merging** and no document reuse. Loading a document
always fully replaces the scene by disposing the previous document; a provided
document is the first and only document loaded (no placeholder default scene is
built first). `CVDocument.openDocument(data, path)` runs on the freshly-created,
empty document, so it never needs to clear or preserve any existing scene
content or setup — the previous document (scene graph *and* setup) was disposed
wholesale by the swap above.

The default template scene (`templates/default.svx.json`) is only used when:

- nothing is provided (standalone mode), or
- a raw `model`/`geometry` is loaded — `loadModel`/`loadGeometry` build their own
  document from the default template and then append the asset to it.

Appending raw models/geometry **to the active document** remains supported
(`CVDocumentProvider.appendModel` / `appendGeometry`), e.g. for the Story
authoring tool. What is removed is merging one *document* into another.

## Lifecycle state machine

`CVDocumentProvider.outs.state` exposes an `EDocumentState`
(`source/client/schema/document.ts`):

| State          | Meaning                                                            |
|----------------|-------------------------------------------------------------------|
| `Initializing` | System components built, no document active yet (e.g. embedded mode before the host calls `loadDocument`). |
| `Loading`      | An initial document/model load is in flight.                      |
| `Ready`        | A document is active and interactable. An empty or default-template document is a valid scene and reports `Ready`. |
| `Error`        | The last load failed.                                             |

The state is derived from existing signals — `CVAssetManager.outs.initialLoad`,
`CVAssetManager.outs.busy`, and the active viewer's `CVViewer.outs.sceneLoaded`
— not from a parallel counter. `Initializing` is not "empty document":
emptiness is not a state, an empty scene is simply `Ready`.

## Consuming the contract from outside

On the `<voyager-explorer>` custom element:

- **`getState()`** returns the current state name
  (`"Initializing" | "Loading" | "Ready" | "Error"`).
- DOM `CustomEvent`s are dispatched on the element:
  - `load-start` — a load begins (entering `Loading`),
  - `load-end` — a load ends (leaving `Loading`),
  - `scene-ready` — the scene becomes interactable (entering `Ready`),
  - `document-state` — every transition, with `detail` set to the state name,
  - `model-load` — per derivative loaded, with `detail` set to the quality.

Example:

```js
const el = document.querySelector("voyager-explorer");
el.addEventListener("load-start", () => console.log("loading..."));
el.addEventListener("scene-ready", () => console.log("interactable:", el.getState()));
```
