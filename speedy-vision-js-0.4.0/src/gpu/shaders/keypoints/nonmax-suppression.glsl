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
 * nonmax-suppression.glsl
 * Corner detection: non-maximum suppression
 */

uniform sampler2D image;

// non-maximum suppression on 8-neighborhood based
// on the corner score stored in the red channel
void main()
{
    // 8-neighborhood
    float p0 = pixelAtShortOffset(image, ivec2(0, 1)).r;
    float p1 = pixelAtShortOffset(image, ivec2(1, 1)).r;
    float p2 = pixelAtShortOffset(image, ivec2(1, 0)).r;
    float p3 = pixelAtShortOffset(image, ivec2(1, -1)).r;
    float p4 = pixelAtShortOffset(image, ivec2(0, -1)).r;
    float p5 = pixelAtShortOffset(image, ivec2(-1, -1)).r;
    float p6 = pixelAtShortOffset(image, ivec2(-1, 0)).r;
    float p7 = pixelAtShortOffset(image, ivec2(-1, 1)).r;

    // maximum score
    float m = max(
        max(max(p0, p1), max(p2, p3)),
        max(max(p4, p5), max(p6, p7))
    );

    // non-maximum suppression
    vec4 pixel = threadPixel(image);
    float score = step(m, pixel.r) * pixel.r;
    color = vec4(score, pixel.gba);
}