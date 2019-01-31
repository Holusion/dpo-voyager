/**
 * 3D Foundation Project
 * Copyright 2018 Smithsonian Institution
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

import { Dictionary } from "@ff/core/types";
import Component from "@ff/graph/Component";

////////////////////////////////////////////////////////////////////////////////

export default class CVMeta extends Component
{
    protected data: Dictionary<any> = {};

    set(key: string, value: any)
    {
        this.data[key] = value;
    }

    get(key: string)
    {
        return this.data[key];
    }

    remove(key: string)
    {
        delete this.data[key];
    }

    clear()
    {
        this.data = {};
    }

    hasData()
    {
        return Object.keys(this.data).length > 0;
    }

    deflate()
    {
        const data = this.toData();
        return data ? { data } : null;
    }

    inflate(json: any)
    {
        if (json.data) {
            this.fromData(json);
        }
    }

    toData(): Dictionary<any> | null
    {
        return this.hasData() ? Object.assign({}, this.data) : null;
    }

    fromData(data: Dictionary<any>)
    {
        this.data = Object.assign({}, data);
    }
}