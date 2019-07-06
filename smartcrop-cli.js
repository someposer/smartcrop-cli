#!/usr/bin/env node
/** smartcrop-cli.js
 *
 * Command line interface for smartcrop.js
 *
 * Copyright (C) 2014 Jonas Wagner
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

var argv = require('yargs')
    .usage('Usage: $0 [OPTION] FILE [OUTPUT]')
    .example(
      '$0 --width 100 --height 100 photo.jpg square-thumbnail.jpg',
      'generate a 100x100 thumbnail from photo.jpg'
    )
    .config('config')
    .default('quality', 90)
    .default('outputFormat', 'jpg')
    .boolean('faceDetection')
    .choices('model', ['tiny', 'ssd', 'mtcnn']).default('model', 'tiny')
    .describe({
      config: 'path to a config.json',
      width: 'width of the crop',
      height: 'height of the crop',
      faceDetection: 'perform face detection using face-api.js',
      model: 'face detection model',
      outputFormat: 'image magick output format string',
      quality: 'jpeg quality of the output image',
      '*': 'forwarded as options to smartcrop.js'
    })
    //.demand(['input', 'width','height'])
    .demand(1).argv,
  input = argv._[0],
  output = argv._[1];

var concat = require('concat-stream');
var gm = require('gm').subClass({ imageMagick: true });
var smartcrop = require('smartcrop-gm');
var _ = require('underscore');

var faceapi;
var canvas;

if (argv.faceDetection) {
  try {
    // Ignore FensorFlow CPU warnings
    process.env.TF_CPP_MIN_LOG_LEVEL = 2;

    try {
      require('@tensorflow/tfjs-node');
    } catch (err) {
      console.warn("missing tensorflow");
    }
    canvas = require('canvas');
    faceapi = require('face-api.js');
  
    const { Canvas, Image, ImageData } = canvas;

    faceapi.env.monkeyPatch({ Canvas, Image, ImageData });
  } catch (e) {
    console.error(e);
    console.error('skipping faceDetection');
    argv.faceDetection = false;
  }
}

var options = _.extend({}, argv.config, _.omit(argv, 'config', 'quality', 'faceDetection', 'model'));

function resize(result) {
  var crop = result.topCrop;
  var cmd = gm(input)
    .crop(crop.width, crop.height, crop.x, crop.y)
    .resize(options.width, options.height)
    .unsharp('2x0.5+1+0.008')
    .colorspace('sRGB')
    .autoOrient()
    .strip();

  if (argv.quality) {
    cmd = cmd.quality(argv.quality);
  }

  if (output === '-') {
    cmd.stream(argv.outputFormat).pipe(process.stdout);
  } else {
    cmd.write(output, function(err) {
      if (err) console.error(err);
    });
  }
}

async function faceDetect(input, options) {
  if (!argv.faceDetection) return;

  try {
    const image = await canvas.loadImage(input);
    var model;
    switch (argv.model) {
      case 'ssd':
        await faceapi.nets.ssdMobilenetv1.loadFromDisk(__dirname + '/weights');
        model = new faceapi.SsdMobilenetv1Options();
        break;
      case 'mtcnn':
        await faceapi.nets.mtcnn.loadFromDisk(__dirname + '/weights');
        model = new faceapi.MtcnnOptions();
        break;
      default:
        await faceapi.nets.tinyFaceDetector.loadFromDisk(__dirname + '/weights');
        model = new faceapi.TinyFaceDetectorOptions();
        break;
    }

    const faces = await faceapi.detectAllFaces(image, model);
    
    options.boost = faces.map(function(face) {
      var box = face.box;
      return {
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
        weight: 1.0
      };
    });
  } catch (err) {
    console.error(err);
  }
}

function analyse() {
  faceDetect(input, options)
    .then(function() {
      return smartcrop.crop(input, options);
    })
    .then(
      function(result) {
        if (output !== '-') {
          console.log(JSON.stringify(result, null, '  '));
        }
        if (output && options.width && options.height) {
          resize(result);
        }
      },
      function(err) {
        console.error(err.stack);
      }
    );
}

if (input === '-') {
  process.stdin.pipe(
    concat(function(inputBuffer) {
      input = inputBuffer;
      analyse();
    })
  );
} else {
  analyse();
}
