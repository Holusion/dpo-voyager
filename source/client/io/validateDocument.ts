/**
 * Copyright 2026 Holusion SAS
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

import AjvCore from "ajv";

import documentSchema from "client/schema/json/document.schema.json";
import commonSchema from "client/schema/json/common.schema.json";
import metaSchema from "client/schema/json/meta.schema.json";
import modelSchema from "client/schema/json/model.schema.json";
import setupSchema from "client/schema/json/setup.schema.json";

import type { IDocument } from "client/schema/document";

////////////////////////////////////////////////////////////////////////////////

export type ValidationResult = { error: string | null };

const schemaValidator = new AjvCore({
    schemas: [
        documentSchema,
        commonSchema,
        metaSchema,
        modelSchema,
        setupSchema,
    ],
    allErrors: true
});

// Resolved at worker startup so a missing / un-compilable schema surfaces as
// an onerror in the parent immediately, not on the first validation call.
const validateDocument = schemaValidator.getSchema(
    "https://schemas.3d.si.edu/voyager/document.schema.json"
);
if(!validateDocument){
    throw new Error(`Failed to get document schema validator`);
}

/**
 * Web worker that validates a document against the JSON-schema. Both outcomes
 * (success and validation failure) are reported via postMessage so they can be
 * correlated to the request that produced them. onerror is reserved for
 * unexpected failures such as schema setup above.
 */
onmessage = ({data}:MessageEvent<IDocument>) => {
    const result: ValidationResult = validateDocument(data)
        ? { error: null }
        : { error: schemaValidator.errorsText(
            validateDocument.errors, { separator: ", ", dataVar: "document" }) };
    postMessage(result);
};
