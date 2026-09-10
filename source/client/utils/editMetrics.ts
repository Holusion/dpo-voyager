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
 * INSTRUMENTATION - not part of the edit journal's behaviour.
 *
 * What edit detection costs, measured where it is spent. Everything here and
 * every call site can be deleted together without touching the feature: the
 * call sites are `if (metrics.enabled)` guards and one timestamp each.
 *
 * The numbers worth reading are per frame, not totals: detection runs inside
 * Graph.tick, once per changed component, and scans that component's inputs. A
 * scene sitting still changes nothing and costs nothing; a slider drag changes
 * one component a frame; a model load or an undo can change many at once.
 *
 * From the browser console:
 *
 *     const m = voyagerStory.system.components.get("CVSaveState").metrics;
 *     m.reset();          // start a measurement
 *     m.format();         // read it back
 *
 * Enabled by default in development builds only. Timing itself is not free -
 * two performance.now() calls per changed component - so the reported cost is
 * an upper bound on what a production build pays.
 */
export default class EditMetrics
{
    /** Off means no timestamps are taken and no counters move. */
    enabled: boolean = typeof ENV_DEVELOPMENT !== "undefined" && ENV_DEVELOPMENT;

    /** Frames seen while edit detection was armed. */
    frames = 0;
    /** Times the change observer was called, i.e. component-changes seen. */
    scans = 0;
    /** Properties looked at across all those scans. */
    properties = 0;
    /** Values copied out of a property, the one allocation in the hot path. */
    clones = 0;
    /** Changes handed to the journal. */
    records = 0;
    /** Changes seen while detection was suspended, and dropped. */
    suspended = 0;

    /** Milliseconds inside the change observer. */
    scanTime = 0;
    /** Worst single frame's observer time, in milliseconds. */
    peakScanTime = 0;
    /** Milliseconds taken by the one-off baseline snapshot, and its size. */
    seedTime = 0;
    seedProperties = 0;
    /** Undo and redo: how many, and the milliseconds spent applying them. */
    applies = 0;
    applyTime = 0;

    /**
     * The suspension machinery, which is the part with a call rate worth
     * knowing: withoutEdits brackets every derived write in the scene, and
     * each bracket flushes what is pending on the way in and walks the graph
     * on the way out.
     */
    suspends = 0;
    /** Milliseconds inside suspend() - the flush of pending changes. */
    flushTime = 0;
    /** Components the flush had to look at. */
    flushed = 0;
    /** Times resume() closed the outermost bracket and deferred a frame. */
    defers = 0;
    /** Milliseconds inside deferSuspension() - the walk over the graph. */
    deferTime = 0;
    /** Components that walk found already changed, and took over. */
    deferredComponents = 0;

    private _frameTime = 0;
    private _frame = -1;

    /**
     * Size of what the feature is holding on to, for the memory question.
     * Read when a report is asked for, not per frame: counting records means
     * walking the journal, which has no business being in the hot path.
     */
    holdings: () => { shadow: number, entries: number, records: number } = null;

    reset()
    {
        this.frames = this.scans = this.properties = this.clones = 0;
        this.records = this.suspended = 0;
        this.scanTime = this.peakScanTime = 0;
        this.seedTime = this.seedProperties = 0;
        this.applies = this.applyTime = 0;
        this.suspends = this.flushTime = this.flushed = 0;
        this.defers = this.deferTime = this.deferredComponents = 0;
        this._frameTime = 0;
        this._frame = -1;
    }

    now()
    {
        return performance.now();
    }

    /** One pass of the change observer over one component. */
    addScan(started: number, frame: number, properties: number, clones: number, records: number, suspended: boolean)
    {
        const elapsed = performance.now() - started;

        ++this.scans;
        this.properties += properties;
        this.clones += clones;
        this.records += records;
        this.scanTime += elapsed;

        if (suspended) {
            ++this.suspended;
        }

        // Peak is per frame, not per call: several components changing in the
        // same frame is exactly the case that could show up as a hitch.
        if (frame !== this._frame) {
            this._frame = frame;
            this._frameTime = 0;
        }

        this._frameTime += elapsed;

        if (this._frameTime > this.peakScanTime) {
            this.peakScanTime = this._frameTime;
        }
    }

    addSeed(started: number, properties: number)
    {
        this.seedTime += performance.now() - started;
        this.seedProperties += properties;
    }

    addApply(started: number)
    {
        this.applyTime += performance.now() - started;
        ++this.applies;
    }

    /** One suspend(), with the flush it performed on the way in. */
    addSuspend(started: number, flushed: number)
    {
        this.flushTime += performance.now() - started;
        this.flushed += flushed;
        ++this.suspends;
    }

    /** One resume() that closed the outermost bracket. */
    addDefer(started: number, components: number)
    {
        this.deferTime += performance.now() - started;
        this.deferredComponents += components;
        ++this.defers;
    }

    /** Plain numbers, for a test to assert on or a driver to print. */
    report()
    {
        const frames = this.frames || 1;

        return {
            frames: this.frames,
            scans: this.scans,
            scansPerFrame: this.scans / frames,
            propertiesPerFrame: this.properties / frames,
            clonesPerFrame: this.clones / frames,
            changesRecorded: this.records,
            suspendedScans: this.suspended,
            scanTimeMs: this.scanTime,
            scanTimePerFrameMs: this.scanTime / frames,
            peakScanTimeMs: this.peakScanTime,
            seedTimeMs: this.seedTime,
            seedProperties: this.seedProperties,
            applies: this.applies,
            applyTimePerCallMs: this.applies ? this.applyTime / this.applies : 0,
            suspends: this.suspends,
            suspendsPerFrame: this.suspends / frames,
            flushTimeMs: this.flushTime,
            flushedComponents: this.flushed,
            defers: this.defers,
            deferTimeMs: this.deferTime,
            deferredComponents: this.deferredComponents,
            suspensionTimePerFrameMs: (this.flushTime + this.deferTime) / frames,
            ...(this.holdings ? this.holdings() : { shadow: 0, entries: 0, records: 0 }),
        };
    }

    format()
    {
        const r = this.report();
        const ms = (v: number) => `${v.toFixed(4)} ms`;

        return [
            `edit detection over ${r.frames} armed frames`,
            `  scans           ${r.scans} (${r.scansPerFrame.toFixed(2)}/frame, ${r.suspendedScans} suspended)`,
            `  properties      ${r.propertiesPerFrame.toFixed(1)}/frame`,
            `  value clones    ${r.clonesPerFrame.toFixed(2)}/frame`,
            `  time            ${ms(r.scanTimePerFrameMs)}/frame, ${ms(r.peakScanTimeMs)} worst frame, ${ms(r.scanTimeMs)} total`,
            `  baseline snapshot ${ms(r.seedTimeMs)} for ${r.seedProperties} properties`,
            `  undo/redo       ${r.applies} applied, ${ms(r.applyTimePerCallMs)} each`,
            `  suspensions     ${r.suspends} (${r.suspendsPerFrame.toFixed(2)}/frame), ${r.defers} deferred a frame`,
            `  suspension time ${ms(r.suspensionTimePerFrameMs)}/frame (flush ${ms(r.flushTimeMs)} over ${r.flushedComponents} components, defer ${ms(r.deferTimeMs)} over ${r.deferredComponents})`,
            `  holding         ${r.shadow} shadowed values, ${r.entries} entries / ${r.records} records`,
        ].join("\n");
    }
}
