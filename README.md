#stream-transcoder.js
**FFmpeg based media transcoder that supports streams.**

##Introduction
Flexible media transcoding using FFmpeg. Stream media in and out - converting it on the fly.

I created this, because the current FFmpeg transcoders for node.js did not properly support streams as I needed.

Along with the [stream-body-parser.js](https://github.com/trenskow/stream-body-parser.js), this makes a great companion for doing stuff like this.

    var express = require('express'),
        StreamBodyParser = require('stream-body-parser'),
        Transcoder = require('stream-transcoder');
    
    var app = express();
    
    var bodyParser = new StreamBodyParser(app);
    
    bodyParser.process('video/*', function(stream, req, next) {
    	
    	var myGridFSWriteStream = (Some MongoDB GridFS stream)
    	
    	new Transcoder(stream)
    	    .maxSize(320, 240)
    	    .videoCodec('h264')
    	    .videoBitrate(800 * 1000)
    	    .fps(25)
    	    .audioCodec('libfaac')
    	    .sampleRate(44100)
    	    .channels(2)
    	    .audioBitrate(128 * 1000)
    	    .format('mp4')
    	    .on('finish', function() {
    	    	next();
    	    })
    	    .stream().pipe(myGridFSWriteStream);
    	
    });
    
    app.post('/', function(req, res) {
    	res.send(200); // File uploaded
    });
    
    app.listen(3000);
    
In the above example the video is transcoded as it is being uploaded, and then piped directly into the database. So when the route is being called, the video is transcoded and stored.

## Installing FFmpeg
FFmpeg is not installed with this package. So before usage, install FFmpeg using your favorite package manager or download it at [ffmpeg.org](http://ffmpeg.org/).

### Configure FFmpeg binary path

Set the `FFMPEG_BIN_PATH` env var. (`ffmpeg` by default)

## Class: Transcoder
`Transcoder` is an EventEmitter.

This class transcodes from one media format to another. It supports both files and streams as input and/or output. Some formats are not suited for streaming, in which case the `Transcoder` will emit an `error`, but most formats are.

### new Transcoder(stream)

  * `stream` Object - A readable stream.
  
Prepares a new Transcoder with a stream as its input.

### new Transcoder(file)

  * `file` String - The path of the file to be transcoded.

Prepares a new Transcoder with a file as its input.

### Event: 'metadata'

  * `metadata` Object - Metadata of input and output streams.

Emitted when metadata is available for both input and output streams. If no output is specified (by using `transcoder.exec()`), only input streams will be described.

This an example of a transcoding process metadata.

    {
        "input": {
            "streams": [
                {
                    "type": "video",
                    "codec": "h264",
                    "bitrate": 10131000,
                    "fps": 25,
                    "size": {
                        "width": 1280,
                        "height": 720
                    },
                    "aspect": 1.7777777777777777,
                    "colors": "yuv420p"
                },
                {
                    "type": "audio",
                    "codec": "aac",
                    "samplerate": 44100,
                    "channels": 2,
                    "bitrate": 106000
                }
            ],
            "duration": 250068,
            "synched": true
        },
        "output": {
            "streams": [
                {
                    "type": "video",
                    "codec": "h264",
                    "bitrate": 800000,
                    "size": {
                        "width": 320,
                        "height": 180
                    },
                    "aspect": 1.7777777777777777,
                    "colors": "yuv420p"
                },
                {
                    "type": "audio",
                    "codec": "aac",
                    "samplerate": 44100,
                    "channels": 2,
                    "bitrate": 128000
                }
            ]
        }
    }

### Event: 'progress'

  * `progress` Object - Object describing current progress.

Emitted when progress has been made in the transcoding.

This is an example of the `progress` object. Where `progress.progress` is a percentage of the total transcoding job.

    {
        "frame": 508,
        "fps": 253,
        "quality": 16,
        "size": 1553408,
        "time": 20041,
        "bitrate": 608000,
        "progress": 0.08014220132124063
    }

### Event: 'finish'

Emitted when transcoding is complete.

### Event: 'error'

  * `error` Error - The error that occured.

Emitted when FFmpeg exits with an error.

### transcoder.videoCodec(codec)

  * `codec` String - Name of the video codec. As an example `h264`.

Sets the video codec.

Returns transcoder object.

*Notice:* Supported video codecs depends on your FFmpeg installation. Running `ffmpeg -codecs` from your terminal will list the supported codecs.

### transcoder.videoBitrate(bitrate)

  * `bitrate` Number or String - The bitrate of the encoded video. Both `1280000` or `128 kbit` can be passed.

Sets the video bitrate.

Returns transcoder object.

### transcoder.fps(fps)

  * `fps` Number - Frames per second.

Sets the number of frames per second.

Returns transcoder object.

### transcoder.format(format)

  * `format` String - Output format.

Sets the output format.

Returns transcoder object.

*Notice:* Supported formats also depends on you FFmpeg installation. Running `ffmpeg -formats` from your terminal will list the supported formats.

### transcoder.maxSize(width, height)

  * `width` Number - Maximum width of video.
  * `height` Number - Miximum height of video.

Sets the output video size, shrinking to fit the size to maintain aspect ratio. The output video will be within the defined size, but with aspect ratio is preserved.

Returns transcoder object.

### transcoder.minSize(width, height)

  * `width` Number - Minimum width of video.
  * `height` Number - Minimum height of video.

Sets the output video size, scaling it to have a minimum of both directions, while maintaining aspect ratio.

### transcoder.size(width, height)

  * `width` Number - Minimum width of video.
  * `height` Number - Minimum height of video.

Sets the output video size, not maintaining aspect ratio if it doesn't fit.

Returns transcoder object.

### transcoder.passes(passes)

   * `passes` Number - The number of encoder passes.

Sets the number of encoder passes.

Returns transcoder object.

### transcoder.aspectRatio(ratio)

   * `ratio` Number - The desired aspect ratio. As an example `1.7777777`.

Sets the video aspect ratio.

Returns transcoder object.

### transcoder.audioCodec(codec)

  * `codec` String - Name of the audio codec. As an example `mp3` or `aac`.

Sets the audio codec.

Returns transcoder object.

*Notice:* Supported audio codecs depends on your FFmpeg installation. Running `ffmpeg -codecs` from your terminal will list the supported codecs.

### transcoder.sampleRate(rate)

  * `rate` Number - Audio sample rate. As an example `44100`.

Sets the audio sample rate.

Returns transcoder object.

### transcoder.channels(channels)

  * `channels` Number - Number of audio channels.

Sets the number of audio channels.

Returns transcoder object.

### transcoder.audioBitrate(bitrate)

  * `bitrate` Number - The audio bitrate.

Sets the audio bitrate.

Returns transcoder object.

### transcoder.captureFrame(time)

  * `time` Number - Time of frame in milliseconds.

Capture a single frame at `time`. Sets up transcoder to jpeg output.

Returns transcoder object.

### transcoder.stream()

Returns a writeable stream that will emit the transcoded media data.

### transcoder.writeToFile(file)

   * `file` String - Path of filename.

Writes transcoded media data to `file`.

Returns transcoder object.

### transcoder.exec()

Executes the transcoder without outputting any data. This is useful if you only need metadata for a media file.

Returns child process.

### transcoder.custom(key, value)

   * `key` String - The key for the parameter
   * `value` String [optional] - The value for the parameter.

Adds a custom parameter to the FFmpeg command line - this is for all your special needs that is currently not implemented as a function in the Transcoder.

As an example:

    .custom('ss', '00:30:00')
    
Translates to on the FFmpeg command line:

    ffmpeg -ss 00:30:00


