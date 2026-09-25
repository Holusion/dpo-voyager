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
 * Fetches raw bytes for a URL, deduplicating concurrent requests for the same
 * URL and letting each caller abort just its own interest in it: the
 * underlying `fetch` is only cancelled once every caller has aborted.
 *
 * Extracted from the glTF loader so any binary-format loader (glTF today,
 * potentially others later) can reuse the same cancellable, shared fetch
 * behavior without depending on three.js' LoadingManager/FileLoader, whose
 * progress tracking isn't used here.
 */
export default class AbortableLoadQueue
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
