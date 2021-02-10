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
 * encoders.js
 * Texture encoders
 */

import { SpeedyProgramGroup } from '../speedy-program-group';
import { importShader } from '../shader-declaration';
import { SpeedyFeature } from '../../core/speedy-feature';
import { BinaryDescriptor } from '../../core/speedy-descriptor';
import { StochasticTuner } from '../../core/tuners/stochastic-tuner';
import { Utils } from '../../utils/utils'
import { IllegalOperationError } from '../../utils/errors';
import { FIX_RESOLUTION, PYRAMID_MAX_LEVELS, LOG2_PYRAMID_MAX_SCALE, MAX_TEXTURE_LENGTH } from '../../utils/globals';

// We won't admit more than MAX_KEYPOINTS per media.
// The larger this value is, the more data we need to transfer from the GPU.
const MAX_DESCRIPTOR_SIZE = 64; // in bytes, must be divisible by 4 (1 pixel = 4 bytes)
const MAX_KEYPOINT_SIZE = 8 + MAX_DESCRIPTOR_SIZE; // in bytes, must be divisible by 4
const MAX_PIXELS_PER_KEYPOINT = (MAX_KEYPOINT_SIZE / 4) | 0; // in pixels
const MIN_ENCODER_LENGTH = 1;
const MAX_ENCODER_LENGTH = 300; // in pixels (if too large, WebGL may lose context - so be careful!)
const MAX_KEYPOINTS = ((MAX_ENCODER_LENGTH * MAX_ENCODER_LENGTH) / MAX_PIXELS_PER_KEYPOINT) | 0;
const INITIAL_ENCODER_LENGTH = 16; // pick a small number to reduce processing load and not crash things on mobile (WebGL lost context)
const KEYPOINT_BUFFER_LENGTH = 1024; // maximum number of keypoints that can be uploaded to the GPU via UBOs



//
// Shaders
//

// encode keypoint offsets: maxIterations is an integer in [1,255], determined experimentally
const encodeKeypointOffsets = importShader('encoders/encode-keypoint-offsets.glsl').withArguments('image', 'imageSize', 'maxIterations');

// encode keypoints
const encodeKeypoints = importShader('encoders/encode-keypoints.glsl').withArguments('image', 'imageSize', 'encoderLength', 'descriptorSize');

// helper for downloading the keypoints
const downloadKeypoints = importShader('utils/identity.glsl').withArguments('image');

// upload keypoints via UBO
const uploadKeypoints = importShader('encoders/upload-keypoints.glsl')
                       .withArguments('keypointCount', 'encoderLength', 'descriptorSize')
                       .withDefines({
                           'KEYPOINT_BUFFER_LENGTH': KEYPOINT_BUFFER_LENGTH
                       });




/**
 * GPUEncoders
 * Keypoint encoding
 */
export class GPUEncoders extends SpeedyProgramGroup
{
    /**
     * Class constructor
     * @param {SpeedyGPU} gpu
     * @param {number} width
     * @param {number} height
     */
    constructor(gpu, width, height)
    {
        super(gpu, width, height);
        this
            .declare('_encodeKeypointOffsets', encodeKeypointOffsets)

            // tiny textures
            .declare('_encodeKeypoints', encodeKeypoints, {
                ...this.program.hasTextureSize(INITIAL_ENCODER_LENGTH, INITIAL_ENCODER_LENGTH)
            })
            .declare('_downloadKeypoints', downloadKeypoints, {
                ...this.program.hasTextureSize(INITIAL_ENCODER_LENGTH, INITIAL_ENCODER_LENGTH)
            })
            .declare('_uploadKeypoints', uploadKeypoints, {
                ...this.program.hasTextureSize(INITIAL_ENCODER_LENGTH, INITIAL_ENCODER_LENGTH)
            })
        ;

        // setup internal data
        let neighborFn = (s) => Math.round(Utils.gaussianNoise(s, 64)) % 256;
        this._tuner = new StochasticTuner(48, 32, 48, 0.2, 8, 60, neighborFn);
        this._encoderLength = INITIAL_ENCODER_LENGTH;
        this._spawnedAt = performance.now();
        this._uploadBuffer = null; // lazy spawn
    }

    /**
     * Keypoint encoder length
     * @returns {number}
     */
    get encoderLength()
    {
        return this._encoderLength;
    }

    /**
     * Optimizes the keypoint encoder for an expected number of keypoints
     * @param {number} keypointCount expected number of keypoints (< 0 resets the encoder)
     * @param {number} descriptorSize in bytes
     * @returns {boolean} true if the encoder has been optimized
     */
    optimize(keypointCount, descriptorSize)
    {
        const newEncoderLength = this._minimumEncoderLength(keypointCount, descriptorSize);
        const oldEncoderLength = this._encoderLength;

        this._encoderLength = newEncoderLength;
        //console.log('optimized for', keypointCount, 'keypoints. length:', newEncoderLength);

        return (newEncoderLength - oldEncoderLength) != 0;
    }

    /**
     * Ensures that the encoder has enough capacity to deliver the specified number of keypoints
     * @param {number} keypointCount the number of keypoints
     * @param {number} descriptorSize in bytes
     * @returns {boolean} true if there was any change to the length of the encoder
     */
    reserveSpace(keypointCount, descriptorSize)
    {
        // resize if not enough space
        if(this._minimumEncoderLength(keypointCount, descriptorSize) > this._encoderLength)
            return this.optimize(keypointCount, descriptorSize);

        return false;
    }

    /**
     * Encodes the keypoints of an image into a compressed texture
     * @param {SpeedyTexture} corners texture with corners
     * @param {number} descriptorSize in bytes
     * @returns {SpeedyTexture} texture with encoded keypoints
     */
    encodeKeypoints(corners, descriptorSize)
    {
        // parameters
        const encoderLength = this._encoderLength;
        const imageSize = [ this._width, this._height ];
        const maxIterations = this._tuner.currentValue(); // any value between 32 and 48 should work on PC & mobile

        // encode offsets
        const offsets = this._encodeKeypointOffsets(corners, imageSize, maxIterations);

        // encode keypoints
        this._encodeKeypoints.resize(this._encoderLength, this._encoderLength);
        this._encodeKeypoints.clear(0, 0, 0, 0); // clear all pixels to 0
        return this._encodeKeypoints(offsets, imageSize, encoderLength, descriptorSize);
    }

    /**
     * Decodes the keypoints, given a flattened image of encoded pixels
     * @param {Uint8Array[]} pixels pixels in the [r,g,b,a,...] format
     * @param {number} descriptorSize in bytes
     * @param {object} [output] optional output object
     * @param {number[]} [output.userData] generic user-data related to the i-th keypoint
     * @param {boolean[]} [output.discard] signals that the i-th keypoint should be discarded
     * @returns {SpeedyFeature[]} keypoints
     */
    decodeKeypoints(pixels, descriptorSize, output = {})
    {
        const pixelsPerKeypoint = 2 + descriptorSize / 4;
        let x, y, lod, rotation, score;
        let hasLod, hasRotation;
        let discardCount = 0;
        const keypoints = [];

        // initialize output arrays
        if(output.userData != undefined)
            output.userData.length = 0;
        if(output.discard != undefined)
            output.discard.length = 0;

        // how many bytes should we read?
        const e = this._encoderLength;
        const e2 = e * e * pixelsPerKeypoint * 4;
        const size = Math.min(pixels.length, e2);

        // for each encoded keypoint
        for(let i = 0; i < size; i += 4 /* RGBA */ * pixelsPerKeypoint) {
            // extract fixed-point coordinates
            x = (pixels[i+1] << 8) | pixels[i];
            y = (pixels[i+3] << 8) | pixels[i+2];
            if(x >= 0xFFFF && y >= 0xFFFF) // if end of list
                break;

            // We've cleared the texture to black.
            // Likely to be incorrect black pixels
            // due to resize. Bad for encoderLength
            if(x + y == 0 && pixels[i+6] + pixels[i+5] == 0)
                continue; // discard, it's noise

            // convert from fixed-point
            x /= FIX_RESOLUTION;
            y /= FIX_RESOLUTION;

            // emit signal to discard keypoints outside the image
            const isDiscardedKeypoint = (x > MAX_TEXTURE_LENGTH || y > MAX_TEXTURE_LENGTH || x < 0 || y < 0);
            if(output.discard != undefined)
                output.discard.push(isDiscardedKeypoint);
            if(output.discardCount != undefined && isDiscardedKeypoint)
                output.discardCount[0] = ++discardCount;

            // extract LOD
            hasLod = (pixels[i+4] < 255);
            lod = !hasLod ? 0.0 :
                -LOG2_PYRAMID_MAX_SCALE + (LOG2_PYRAMID_MAX_SCALE + PYRAMID_MAX_LEVELS) * pixels[i+4] / 255.0;

            // extract orientation
            hasRotation = hasLod; // think of a better solution
            rotation = !hasRotation ? 0.0 :
                ((2 * pixels[i+5]) / 255.0 - 1.0) * Math.PI;

            // extract score
            score = pixels[i+6] / 255.0;

            // extract generic user-data
            if(output.userData != undefined) {
                const data = pixels[i+7] / 255.0;
                output.userData.push(data);
            }

            // register keypoint, possibly with a descriptor
            if(descriptorSize > 0) {
                const bytes = new Uint8Array(pixels.slice(i+8, i+8 + descriptorSize));
                const descriptor = new BinaryDescriptor(bytes);
                keypoints.push(new SpeedyFeature(x, y, lod, rotation, score, descriptor));
            }
            else
                keypoints.push(new SpeedyFeature(x, y, lod, rotation, score));
        }

        // developer's secret ;)
        // reset the tuner
        if(keypoints.length == 0) {
            if(this._tuner.finished())
                this._tuner.reset();
        }

        // done!
        return keypoints;
    }

    /**
     * Download RAW encoded keypoint data from the GPU - this is a bottleneck!
     * @param {SpeedyTexture} encodedKeypoints texture with keypoints that have already been encoded
     * @param {boolean} [useAsyncTransfer] transfer data from the GPU without blocking the CPU
     * @param {boolean} [useBufferedDownloads] optimize async transfers
     * @returns {Promise<Uint8Array[]>} pixels in the [r,g,b,a, ...] format
     */
    async downloadEncodedKeypoints(encodedKeypoints, useAsyncTransfer = true, useBufferedDownloads = true)
    {
        try {
            // helper shader for reading the data
            this._downloadKeypoints.resize(this._encoderLength, this._encoderLength);
            this._downloadKeypoints(encodedKeypoints);

            // read data from the GPU
            let downloadTime = performance.now(), pixels;
            if(useAsyncTransfer)
                pixels = await this._downloadKeypoints.readPixelsAsync(0, 0, -1, -1, useBufferedDownloads);
            else
                pixels = this._downloadKeypoints.readPixelsSync(); // bottleneck!
            downloadTime = performance.now() - downloadTime;

            // tuner: drop noisy feedback when the page loads
            if(performance.now() >= this._spawnedAt + 2000)
                this._tuner.feedObservation(downloadTime);

            // debug
            /*
            window._p = window._p || 0;
            window._m = window._m || 0;
            window._m = 0.9 * window._m + 0.1 * downloadTime;
            if(window._p++ % 50 == 0)
                console.log(window._m, ' | ', maxIterations);
            //console.log(JSON.stringify(this._tuner.info()));
            */

            // done!
            return pixels;
        }
        catch(err) {
            throw new IllegalOperationError(`Can't download encoded keypoint texture`, err);
        }
    }

    /**
     * Upload keypoints to the GPU
     * The descriptor & orientation of the keypoints will be lost
     * (need to recalculate)
     * @param {SpeedyFeature[]} keypoints
     * @param {number} descriptorSize in bytes
     * @returns {SpeedyTexture} encodedKeypoints
     */
    uploadKeypoints(keypoints, descriptorSize)
    {
        // Create a buffer for uploading the data
        if(this._uploadBuffer === null) {
            const sizeofVec4 = Float32Array.BYTES_PER_ELEMENT * 4; // 16
            const internalBuffer = new ArrayBuffer(sizeofVec4 * KEYPOINT_BUFFER_LENGTH);
            this._uploadBuffer = new Float32Array(internalBuffer);
        }

        // Format data as follows: (xpos, ypos, lod, score)
        const keypointCount = keypoints.length;
        for(let i = 0; i < keypointCount; i++) {
            const keypoint = keypoints[i];
            const j = i * 4;

            // this will be uploaded into a vec4
            this._uploadBuffer[j]   = +(keypoint.x) || 0;
            this._uploadBuffer[j+1] = +(keypoint.y) || 0;
            this._uploadBuffer[j+2] = +(keypoint.lod) || 0;
            this._uploadBuffer[j+3] = +(keypoint.score) || 0;
        }

        // Reserve space for the keypoints
        this.reserveSpace(keypointCount, descriptorSize);

        // Upload data
        this._uploadKeypoints.resize(this._encoderLength, this._encoderLength);
        this._uploadKeypoints.setUBO('KeypointBuffer', this._uploadBuffer);
        return this._uploadKeypoints(keypointCount, this._encoderLength, descriptorSize);
    }

    /**
     * The minimum encoder length for a set of keypoints
     * @param {number} keypointCount
     * @param {number} descriptorSize
     * @returns {number} between 1 and MAX_ENCODER_LENGTH
     */
    _minimumEncoderLength(keypointCount, descriptorSize)
    {
        const clampedKeypointCount = Math.max(0, Math.min(Math.ceil(keypointCount), MAX_KEYPOINTS));
        const pixelsPerKeypoint = Math.ceil(2 + descriptorSize / 4);
        const len = Math.ceil(Math.sqrt(clampedKeypointCount * pixelsPerKeypoint));

        return Math.max(MIN_ENCODER_LENGTH, Math.min(len, MAX_ENCODER_LENGTH));
    }
}