var util = require('util'),
	EventEmitter = require('events').EventEmitter,
	spawn = require('child_process').spawn,
	readline = require('readline'),
	os = require('os');

	var FFMPEG_BIN_PATH = process.env.FFMPEG_BIN_PATH || 'ffmpeg';
/*
	Transcodes a media stream from one format to another.
	 @source A file or a readable stream. 
	
	Events:
	 'metadata' emitted when media metadata is available. 
	  @metadata (callback parameter) The media mediadata.
	
	 'progress' emitted when transcoding has progressed.
	  @progress (callback parameter) The status of the transcoding process.
	
	 'finish' emitted when transcoding has completed.
	
	 'error' emmited if an error occurs.
	  @error (callback parameter) The error that occured.
	
*/
function Transcoder(source) {
	if (!(this instanceof Transcoder)) return new Transcoder(source);
	
	EventEmitter.call(this);
	
	this.source = source;
	
	this.args = { };
	this.lastErrorLine = null;
	
	Transcoder.prototype._parseMetadata = function(child) {
		
		var self = this;
		
		/* Converts a FFmpeg time format to milliseconds */
		var _parseDuration = function(duration) {
			var d = duration.split(/[:.]/);
			return parseInt(d[0]) * 60 * 60 * 1000
				   + parseInt(d[1]) * 60 * 1000
				   + parseInt(d[2]) * 1000
				   + parseInt(d[3]);
		};
		
		/* Filters for parsing metadata */
		var metadataFilters = {
			'type': {
				match: /Stream #[0-9]+:[0-9]+.*?: (\w+):/i,
				transform: function(r) { if (r[1]) return r[1].toLowerCase(); }
			},
			'codec': {
				match: /Stream.*?:.*?: \w+: (.*?)(?: |\()/i,
				idx: 1
			},
			'samplerate': {
				match: /(\d+) Hz/i,
				idx: 1,
				transform: parseInt
			},
			'channels': {
				match: /\d+ Hz, (.*?)(?:,|$)/i,
				idx: 1,
				transform: function(r) {
					if (r == 'mono') return 1;
					if (r == 'stereo') return 2;
					else return parseInt(r);
				}
			},
			'bitrate': {
				match: /(\d+) (\w)?b\/s/i,
				transform: function(r) {
					if (r[2] == 'k') return parseInt(r[1]) * 1000;
					if (r[2] == 'm') return parseInt(r[1]) * 1000 * 1000;
					return parseInt(r[1]);
				}
			},
			'fps': {
				match: /(\d+) fps/i,
				idx: 1,
				transform: parseInt
			},
			'size': {
				match: /(\d+)x(\d+)(?:,|$)/i,
				transform: function(r) {
					if (r[1] && r[2]) return { width: parseInt(r[1]), height: parseInt(r[2]) };
				}
			},
			'aspect': {
				match: /(\d+)x(\d+)(?:,|$)/i,
				transform: function(r) {
					if (r[1] && r[2]) return parseInt(r[1]) / parseInt(r[2]);
				}
			},
			'colors': {
				match: /Video:.*?, (.*?)(?:,|$)/i,
				idx: 1
			}
		};
		
		/* Filters for parsing progress */
		var progressFilters = {
			'frame': {
				match: /frame= .?([\d]+)/i,
				idx: 1,
				transform: parseInt
			},
			'fps': {
				match: /fps=([\d.]+)/i,
				idx: 1,
				transform: parseInt
			},
			'quality': {
				match: /q=([\d.]+)/i,
				idx: 1,
				transform: parseInt
			},
			'size': {
				match: /size=[\s]+?([\d]+)(\w)?b/i,
				transform: function(r) {
					if (r[2] == 'k') return parseInt(r[1]) * 1024;
					if (r[2] == 'm') return parseInt(r[1]) * 1024 * 1024;
					return parseInt(r[1]);
				}
			},
			'time': {
				match: /time=(\d+:\d+:\d+.\d+)/i,
				idx: 1,
				transform: _parseDuration
			},
			'bitrate': {
				match: /bitrate=[\s]+?([\d.]+)(\w)?bits\/s/i,
				transform: function(r) {
					if (r[2] == 'k') return parseInt(r[1]) * 1000;
					if (r[2] == 'm') return parseInt(r[1]) * 1000 * 1000;
					return parseInt(r[1]);
				}
			}
		};
		
		/* Applies a set of filters to some data and returns the result */
		var _applyFilters = function(data, filters) {
			
			var ret = {}
			for (var key in filters) {
				filter = filters[key];
				var r = filter.match.exec(data) || [];
				if (filter.idx) r = r[filter.idx];
				var v = (filter.transform ? filter.transform(r) : r);
				if (v) ret[key] = v;
			}
			return ret;
			
		}
		
		var metadata = { input: {}, output: {} };
		var current = null;
		
		var metadataLines = readline.createInterface({
			input: child.stderr,
			output: process.stdout,
			terminal: false
		});
		
		var ended = false;
		var _endParse = function() {
			if (!ended) self.emit('metadata', metadata);
			ended = true;
		}
		
		child.on('exit', _endParse);
		
		metadataLines.on('line', function(line) {
			
			try {
				
				if (!ended) {
					
					/* Process metadata */
					
					var line = line.replace(/^\s+|\s+$/g, '');
					
					if (line.length > 0) self.lastErrorLine = line;
					
					if (/^input/i.test(line)) {
						current = metadata.input = { streams: [] };
					} else if (/^output/i.test(line)) {
						current = metadata.output = { streams: [] };
					} else if (/^Metadata:$/i.test(line)) {
						if (current.streams.length) {
							current.streams[current.streams.length - 1].metadata = {};
						} else {
							current.metadata = {};
						}
					} else if (/^duration/i.test(line)) {
						var d = /duration: (\d+:\d+:\d+.\d+)/i.exec(line);
						current.duration = _parseDuration(d[1]);
						current.synched = (/start: 0.000000/.exec(line) != null);
					} else if (/^stream mapping/i.test(line)) {
						_endParse();
					} else if (/^stream #/i.test(line)) {
						current.streams.push(_applyFilters(line, metadataFilters));
					} else {
						var metadataTarget;
						if (current.streams.length && current.streams[current.streams.length - 1].metadata) {
							metadataTarget = current.streams[current.streams.length - 1].metadata;
						} else if (current.metadata) {
							metadataTarget = current.metadata;
						}

						if (metadataTarget) {
							var metadataInfo = line.match(/^(\S+?)\s*:\s*(.+?)$/);
							if (metadataInfo && metadataInfo.length) {
								metadataTarget[metadataInfo[1]] = metadataInfo[2];
							}
						}
					}
					
				}
				
				/* Track progress */
				if (/^(frame|size)=/i.test(line) ) {
					if (!ended) _endParse();
					var progress = _applyFilters(line, progressFilters);
					if (metadata.input.duration) progress.progress = progress.time / metadata.input.duration;
					self.emit('progress', progress);
				}
				
			} catch (e) {
				self.emit('parseError', line);
			}
						
		});
		
	};
	
	/* Spawns child and sets up piping */
	Transcoder.prototype._exec = function(a) {
		
		var self = this;
		
		if ('string' == typeof this.source) a = [ '-i', this.source ].concat(a);
		else a = [ '-i', '-' ].concat(a);
		
		//console.log('Spawning ffmpeg ' + a.join(' '));
		
		var child = spawn(FFMPEG_BIN_PATH, a, {
			cwd: os.tmpdir()
		});
		this._parseMetadata(child);
		
		child.stdin.on('error', function(err) {
			try {
				if ('object' == typeof self.source) self.source.unpipe(this.stdin);
			} catch (e) {
				// Do nothing
			}
		});
		
		child.on('exit', function(code) {
			if (!code) self.emit('finish');
			else self.emit('error', new Error('FFmpeg error: ' + self.lastErrorLine));
		});
		
		/*
		child.stderr.on('data', function(chunk) {
			console.log(chunk.toString());
		});
		*/
		
		if ('object' == typeof this.source) this.source.pipe(child.stdin);
		
		return child;
		
	};
	
	/* Compile arguments for FFmpeg */
	Transcoder.prototype._compileArguments = function () {
		var a = [];
		for (var key in this.args) a = a.concat(this.args[key]);
		return a;
	};
	
	Transcoder.prototype.exec = function() {
		return this._exec(this._compileArguments());
	};
	
	/* Makes FFmpeg write to stdout. Executes and returns stdout. */
	Transcoder.prototype.stream = function() {
		var a = this._compileArguments();
		a.push('pipe:1');
		return (this.stream = this._exec(a).stdout);
	};
	
	/* Makes FFmpeg write to file. Executes */
	Transcoder.prototype.writeToFile = function(file) {
		var a = this._compileArguments();
		a = a.concat('-y', file);
		this._exec(a);
		return this;
	};
	
	/* Set video codec */
	Transcoder.prototype.videoCodec = function(codec) {
		this.args['vcodec'] = [ '-vcodec', codec ];
		return this;
	};
	
	/* Set video bitrate */
	Transcoder.prototype.videoBitrate = function(bitrate) {
		this.args['b'] = [ '-b:v', bitrate ];
		return this;
	};
	
	/* Set frames per second */
	Transcoder.prototype.fps = function(fps) {
		this.args['r'] = [ '-r', fps ];
		return this;
	};
	
	/* Set output format */
	Transcoder.prototype.format = function(format) {
		this.args['format'] = [ '-f', format ];
		if (format.toLowerCase() == 'mp4') this.args['movflags'] = [ '-movflags', 'frag_keyframe+faststart' ];
		return this;
	};
	
	/* Set maximum video size. Adjusts size to maintain aspect ratio, making it fit within the size */
	Transcoder.prototype.maxSize = function(width, height, alwaysScale) {
		if (alwaysScale === undefined) alwaysScale = true;
		var fltWdth = 'min(trunc(' + width + '/hsub)*hsub\\,trunc(a*' + height + '/hsub)*hsub)';
		var fltHght = 'min(trunc(' + height + '/vsub)*vsub\\,trunc(' + width + '/a/vsub)*vsub)';
		if (!alwaysScale) {
			fltWdth = 'min(trunc(iw/hsub)*hsub\\,' + fltWdth + ')';
			fltHght = 'min(trunc(ih/vsub)*vsub\\,' + fltHght + ')';
		}
		this.args['vfscale'] = [ '-vf', 'scale=' + fltWdth + ':' + fltHght ];
		return this;
	};
	
	/* Set minimum video size. Adjusts size to maintain aspect ratio, making it grow to size. */
	Transcoder.prototype.minSize = function(width, height, alwaysScale) {
		if (alwaysScale === undefined) alwaysScale = true;
		var fltWdth = 'max(trunc(' + width + '/hsub)*hsub\\,trunc(a*' + height + '/hsub)*hsub)';
		var fltHght = 'max(trunc(' + height + '/vsub)*vsub\\,trunc(' + width + '/a/vsub)*vsub)';
		if (!alwaysScale) {
			fltWdth = 'max(trunc(iw/hsub)*hsub)\\,' + fltWdth + ')';
			fltHght = 'max(trunc(ih/vsub)*vsub)\\,' + fltHght + ')';
		}
		this.args['vfscale'] = [ '-vf', 'scale=' + fltWdth + ':' + fltHght ];
		return this;
	};
	
	/* Sets the video size. Does not maintain aspect ratio. */
	Transcoder.prototype.size = function(width, height) {
		this.args['s'] = [ '-s', width + 'x' + height ];
		return this;
	};
	
	/* Sets the number of encoder passes. */
	Transcoder.prototype.passes = function(passes) {
		this.args['pass'] = [ '-pass', passes ];
		return this;
	};
	
	/* Sets the aspect ratio. */
	Transcoder.prototype.aspectRatio = function(ratio) {
		this.args['aspect'] = [ '-aspect', ratio ];
		return this;
	};
	
	/* Sets the audio codec */
	Transcoder.prototype.audioCodec = function(codec) {
		this.args['acodec'] = [ '-acodec', codec ];
		return this;
	};
	
	/* Set the audio sample rate */
	Transcoder.prototype.sampleRate = function(samplerate) {
		this.args['ar'] = [ '-ar', samplerate ];
		return this;
	};
	
	/* Set audio channels */
	Transcoder.prototype.channels = function(channels) {
		this.args['ac'] = [ '-ac', channels ];
		return this;
	};
	
	/* Set audio bitrate */
	Transcoder.prototype.audioBitrate = function(bitrate) {
		this.args['ab'] = [ '-ab', bitrate];
		return this;
	};
	
	/* Set custom FFmpeg parameter */
	Transcoder.prototype.custom = function(key, value) {
		var args = [ '-' + key ];
		if (value !== undefined) {
			args.push(value);
		}
		this.args[key] = args;
		return this;
	};
	
	/* Capture still frame. Exports jpeg. */
	Transcoder.prototype.captureFrame = function(time) {
		
		var secs = time / 1000;
		
		var hours = Math.floor(secs / (60 * 60));
		var divisor_for_minutes = secs % (60 * 60);
		var minutes = Math.floor(divisor_for_minutes / 60);

		var divisor_for_seconds = divisor_for_minutes % 60;
		var seconds = Math.ceil(divisor_for_seconds);
		
		while (seconds >= 60) {
			seconds -= 60;
			minutes++;
		}
		
		while (minutes >= 60) {
			minutes -= 60;
			hours++;
		}
				
		var timestamp = hours.toString() + ':' + minutes.toString() + ':' + seconds.toString();
		
		this.args['ss'] = [ '-ss', timestamp, '-an', '-r', '1', '-vframes', '1', '-y' ];
		
		return this.videoCodec('mjpeg').format('mjpeg');
		
	};
	
	return this;
	
}

util.inherits(Transcoder, EventEmitter);

module.exports = Transcoder;
