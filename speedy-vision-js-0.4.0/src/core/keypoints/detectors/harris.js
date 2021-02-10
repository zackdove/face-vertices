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
 * harris.js
 * Harris corner detector
 */

import { SpeedyGPU } from '../../../gpu/speedy-gpu';
import { FeatureDetectionAlgorithm } from '../feature-detection-algorithm';
import { PixelComponent } from '../../../utils/types';
import { PYRAMID_MAX_LEVELS } from '../../../utils/globals';

// constants
const DEFAULT_WINDOW_SIZE = 3; // compute Harris autocorrelation matrix within a 3x3 window
const MIN_WINDOW_SIZE = 0; // minimum window size when computing the autocorrelation matrix
const MAX_WINDOW_SIZE = 7; // maximum window size when computing the autocorrelation matrix
const DEFAULT_ORIENTATION_PATCH_RADIUS = 7; // for computing keypoint orientation
const SOBEL_OCTAVE_COUNT = 2 * PYRAMID_MAX_LEVELS - 1; // Sobel derivatives for each pyramid layer

/**
 * Harris corner detector
 */
export class HarrisFeatures extends FeatureDetectionAlgorithm
{
    /**
     * Harris has no keypoint descriptor
     */
    get descriptorSize()
    {
        return 0;
    }

    /**
     * Detect feature points
     * @param {SpeedyGPU} gpu
     * @param {SpeedyTexture} inputTexture pre-processed greyscale image
     * @param {number} [quality] a value in [0,1]: will pick corners having score >= quality * max(score)
     * @returns {SpeedyTexture} encoded keypoints
     */
    detect(gpu, inputTexture, quality = 0.1)
    {
        const descriptorSize = this.descriptorSize;
        const windowSize = DEFAULT_WINDOW_SIZE;
        const lod = 0, numberOfOctaves = 1;

        // compute derivatives
        const df = gpu.programs.keypoints.multiscaleSobel(inputTexture, lod);
        const sobelDerivatives = Array(SOBEL_OCTAVE_COUNT).fill(df);

        // corner detection
        const corners = gpu.programs.keypoints.multiscaleHarris(inputTexture, windowSize, numberOfOctaves, sobelDerivatives);

        // release derivatives
        df.release();

        // find the maximum corner response
        const maxScore = gpu.programs.utils.scanMax(corners, PixelComponent.RED);

        // discard corners according to quality level
        const filteredCorners = gpu.programs.keypoints.harrisCutoff(corners, maxScore, quality);

        // non-maximum suppression
        const suppressedCorners = gpu.programs.keypoints.nonmaxSuppression(filteredCorners);

        // encode corners
        return gpu.programs.encoders.encodeKeypoints(suppressedCorners, descriptorSize);
    }
}

/**
 * Harris corner detector in an image pyramid
 */
export class MultiscaleHarrisFeatures extends HarrisFeatures
{
    /**
     * Detect feature points
     * @param {SpeedyGPU} gpu
     * @param {SpeedyTexture} inputTexture pre-processed greyscale image
     * @param {number} [quality] a value in [0,1]: will pick corners having score >= quality * max(score)
     * @param {number} [depth] how many pyramid levels will be scanned
     * @returns {SpeedyTexture} encoded keypoints
     */
    detect(gpu, inputTexture, quality = 0.1, depth = 3)
    {
        const descriptorSize = this.descriptorSize;
        const windowSize = DEFAULT_WINDOW_SIZE;
        const numberOfOctaves = 2 * depth - 1;

        // generate pyramid
        const pyramid = inputTexture.generateMipmap();

        // compute derivatives
        const sobelDerivatives = Array(SOBEL_OCTAVE_COUNT);
        for(let j = 0; j < numberOfOctaves; j++)
            sobelDerivatives[j] = gpu.programs.keypoints.multiscaleSobel(pyramid, j * 0.5);
        for(let k = numberOfOctaves; k < sobelDerivatives.length; k++)
            sobelDerivatives[k] = sobelDerivatives[k-1]; // can't call shaders with null pointers

        // corner detection
        const corners = gpu.programs.keypoints.multiscaleHarris(pyramid, windowSize, numberOfOctaves, sobelDerivatives);

        // release derivatives
        for(let i = 0; i < numberOfOctaves; i++)
            sobelDerivatives[i].release();

        // find the maximum corner response
        const maxScore = gpu.programs.utils.scanMax(corners, PixelComponent.RED);

        // discard corners according to the quality level
        const filteredCorners = gpu.programs.keypoints.harrisCutoff(corners, maxScore, quality);

        // non-maximum suppression
        const suppressed1 = gpu.programs.keypoints.samescaleSuppression(filteredCorners);
        const suppressed2 = gpu.programs.keypoints.multiscaleSuppression(suppressed1);

        // encode keypoints
        return gpu.programs.encoders.encodeKeypoints(suppressed2, descriptorSize);
    }

    /**
     * Describe feature points
     * (actually, this just orients the keypoints, since this algorithm has no built-in descriptor)
     * @param {SpeedyGPU} gpu
     * @param {SpeedyTexture} inputTexture pre-processed greyscale image
     * @param {SpeedyTexture} detectedKeypoints tiny texture with appropriate size for the descriptors
     * @returns {SpeedyTexture} tiny texture with encoded keypoints & descriptors
     */
    describe(gpu, inputTexture, detectedKeypoints)
    {
        const descriptorSize = this.descriptorSize;
        const orientationPatchRadius = DEFAULT_ORIENTATION_PATCH_RADIUS;

        // generate pyramid
        const pyramid = inputTexture.generateMipmap();

        // compute orientation
        const encoderLength = gpu.programs.encoders.encoderLength;
        return gpu.programs.keypoints.orientationViaCentroid(pyramid, detectedKeypoints, orientationPatchRadius, descriptorSize, encoderLength);
    }
}