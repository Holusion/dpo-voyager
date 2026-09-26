/**
 * 3D Foundation Project
 * Copyright 2025 Smithsonian Institution
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

////////////////////////////////////////////////////////////////////////////////

/**
 * Fetches raw bytes for a URL, letting each caller abort just its own
 * interest in it: the underlying `fetch` is only cancelled once every caller
 * for that URL has aborted.
 *
 * three.js' own loaders (via FileLoader) already coalesce concurrent requests
 * for the same URL into one in-flight request - but they expose no way to
 * cancel a single one of those requests. The only cancellation they offer is
 * a loader-wide `abort()`/LoadingManager.abortController, which would tear
 * down every load that loader currently has in flight, not just the one a
 * particular caller (e.g. one Derivative being replaced) wants to give up on.
 * This queue exists to get that per-caller cancellation, needed because
 * ModelReader supports aborting an individual model load.
 *
 * Extracted from the glTF loader so any other binary-format loader added
 * later can reuse the same behavior.
 */
export default class LoadQueue
{
    private loading: Record<string, {
        listeners: { onload: (data: ArrayBuffer) => any, onerror: (e: Error) => any, signal?: AbortSignal }[],
        abortController: AbortController,
    }> = {};

    fetch(url: string, { signal }: { signal?: AbortSignal } = {}): Promise<ArrayBuffer>
    {
        if (signal) {
            const onAbort = () => {
                const idx = this.loading[url]?.listeners.findIndex(l => l.signal === signal) ?? -1;
                if (idx === -1) return;
                const { onerror } = this.loading[url].listeners.splice(idx, 1)[0];
                onerror(new DOMException(signal.reason, "AbortError"));

                if (this.loading[url].listeners.length === 0) {
                    ENV_DEVELOPMENT && console.debug("Abort request for URL : ", url);
                    this.loading[url].abortController.abort();
                } else {
                    ENV_DEVELOPMENT && console.debug("Abort listener for URL : %s (%d)", url, this.loading[url].listeners.length);
                }
            };
            signal.addEventListener("abort", onAbort);
        }

        if (!this.loading[url]) {
            const { listeners, abortController: { signal: fetchSignal } } = this.loading[url] = { listeners: [], abortController: new AbortController() };

            fetch(url, {
                signal: fetchSignal,
            }).then(r => {
                if (!r.ok) {
                    throw new Error(`fetch for "${r.url}" responded with ${r.status}: ${r.statusText}`);
                }
                // Skip all the progress tracking from FileLoader since we don't use it.
                return r.arrayBuffer();
            }).finally(() => {
                delete this.loading[url];
            }).then(data => {
                if (fetchSignal.aborted) return; // Might have aborted during the r.arrayBuffer() call
                listeners.forEach(({ onload }) => onload(data));
            }, (e) => {
                listeners.forEach(({ onerror }) => onerror(e));
                if (e.name !== "AbortError" && e.name !== "ABORT_ERR") {
                    console.error(e);
                }
            });
        }

        return new Promise((onload, onerror) => {
            this.loading[url].listeners.push({ onload, onerror, signal });
        });
    }
}
