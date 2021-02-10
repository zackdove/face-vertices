/*
 * speedy-vision.js
 * GPU-accelerated Computer Vision for JavaScript
 * Copyright 2020 Alexandre Martins <alemartf(at)gmail.com>
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * speedy-namespace.js
 * Symbolizes a namespace
 */

import { AbstractMethodError } from '../utils/errors'

/**
 * An abstract namespace
 * @abstract
 */
export class SpeedyNamespace
{
    /**
     * Namespaces can't be instantiated.
     * Only static methods are allowed.
     * @throws SpeedyError
     */
    constructor()
    {
        // only static methods are allowed
        throw new AbstractMethodError(`Namespaces can't be instantiated`);
    }
}