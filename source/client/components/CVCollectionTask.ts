/**
 * 3D Foundation Project
 * Copyright 2026 Smithsonian Institution
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

import CVTask, { types } from "./CVTask";
import CollectionTaskView from "../ui/story/CollectionTaskView";

////////////////////////////////////////////////////////////////////////////////

/**
 * Edits the document's collection metadata. The Story workspace opens the notes editor alongside it
 * while showNotes is set; each start of the task begins with notes hidden.
 */
export default class CVCollectionTask extends CVTask
{
    static readonly typeName: string = "CVCollectionTask";

    static readonly text: string = "Collection";
    static readonly icon: string = "document";

    protected static readonly ins = {
        showNotes: types.Boolean("Notes.Show"),
    };

    ins = this.addInputs<CVTask, typeof CVCollectionTask.ins>(CVCollectionTask.ins);

    deactivateTask()
    {
        this.ins.showNotes.setValue(false);
        super.deactivateTask();
    }

    createView()
    {
        return new CollectionTaskView(this);
    }
}
