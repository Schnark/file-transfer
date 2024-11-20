/*global URL, TextEncoder, TextDecoder, File*/
/*global pako*/
(function () {
"use strict";

var dom, featureValidators;

function isFFOS () {
	return !!navigator.mozSetMessageHandler;
}

dom = {};

function initDom () {
	[
		'main',
		'action',
		'file',
		'send',
		'sendform',
		'code',
		'receive',
		'receiveform',
		'files',
		'info',
		'abort',
		'log',
		'server',
		'about',
		'len',
		'compress',
		'nocompress',
		'obfuscate',
		'save',
		'configform'
	].forEach(function (id) {
		dom[id] = document.getElementById(id);
	});
}

function initButtons (config) {
	//disable
	dom.send.disabled = true;
	dom.receive.disabled = true;
	dom.save.disabled = true;

	//enable when usable
	dom.file.addEventListener('change', function () {
		dom.send.disabled = !dom.file.files.length;
	});
	dom.code.addEventListener('input', function () {
		dom.receive.disabled = !dom.code.value;
	});
	dom.server.addEventListener('change', function () {
		dom.save.disabled = false;
	});
	dom.len.addEventListener('input', function () {
		dom.save.disabled = false;
	});
	dom.compress.addEventListener('change', function () {
		dom.save.disabled = false;
	});
	dom.nocompress.addEventListener('input', function () {
		dom.save.disabled = false;
	});
	dom.obfuscate.addEventListener('change', function () {
		dom.save.disabled = false;
	});

	//action on click/submit
	dom.sendform.addEventListener('submit', function (e) {
		e.preventDefault();
		actionSend(dom.file.files[0], config);
	});
	dom.receiveform.addEventListener('submit', function (e) {
		e.preventDefault();
		actionReceive(dom.code.value, config);
	});
	dom.abort.addEventListener('click', function () {
		dom.action.hidden = true;
		dom.main.hidden = false;
	});
	dom.configform.addEventListener('submit', function (e) {
		e.preventDefault();
		saveConfig(config);
	});
}

//Config
function readConfig () {
	try {
		return JSON.parse(localStorage.getItem('file-transfer-config') || 'x');
	} catch (e) {
		return {
			server: 'https://duct.schollz.com/',
			len: 5,
			compress: true,
			nocompress: 'jpg jpeg png mp3 mp4 3gp ogg ogv webm zip'
		};
	}
}

function initConfig (config) {
	dom.server.value = config.server;
	dom.about.href = config.server;
	dom.len.value = config.len;
	dom.compress.checked = config.compress;
	dom.nocompress.value = config.nocompress;
	dom.obfuscate.checked = config.obfuscate;
	dom.server.addEventListener('change', function () {
		dom.about.href = dom.server.value;
	});
}

function saveConfig (config) {
	config.server = dom.server.value;
	config.len = Number(dom.len.value);
	if (isNaN(config.len) || config.len <= 0 || config.len !== Math.floor(config.len)) {
		config.len = 5;
		dom.len.value = 5;
	}
	config.compress = dom.compress.checked;
	config.nocompress = dom.nocompress.value;
	config.obfuscate = dom.obfuscate.checked;
	dom.save.disabled = true;
	try {
		localStorage.setItem('file-transfer-config', JSON.stringify(config));
	} catch (e) {
	}
}

function log (entry) {
	var li = document.createElement('li');
	li.textContent = entry;
	dom.log.appendChild(li);
}

function getRandomPath (l, lowerLetterOnly) {
	var array = new Uint8Array(l), s = '', i, v;
	if (window.crypto && window.crypto.getRandomValues) {
		window.crypto.getRandomValues(array);
	} else {
		for (i = 0; i < l; i++) {
			array[i] = Math.floor(Math.random() * 256);
		}
	}
	for (i = 0; i < l; i++) {
		v = array[i];
		if (lowerLetterOnly) {
			v = v % 26; //this isn't equally distributed, but who cares
			s += String.fromCharCode(0x61 + v);
		} else {
			v = v % 64;
			if (v < 10) {
				s += String(v);
			} else if (v < 10 + 26) {
				s += String.fromCharCode(0x41 + (v - 10));
			} else if (v < 10 + 26 + 26) {
				s += String.fromCharCode(0x61 + (v - 10 - 26));
			} else {
				s += ['-', '_'][v - 10 - 26 - 26];
			}
		}
	}
	return s;
}

function startAction (info, abort) {
	dom.main.hidden = true;
	dom.action.hidden = false;
	dom.info.innerHTML = info;
	dom.abort.textContent = 'Abort';
	dom.abort.className = 'abort';
	dom.abort.addEventListener('click', abort);
	dom.log.innerHTML = '';
}

function finishAction (info, abort) {
	dom.abort.removeEventListener('click', abort);
	dom.info.innerHTML = info;
	dom.abort.textContent = 'OK';
	dom.abort.className = '';
}

function actionSend (file, config) {
	var code = getRandomPath(config.len, true), abort;
	abort = sendFile(file, code, config, function (success) {
		finishAction(success ? 'File successfully sent.' : 'File was not sent', abort);
	});
	startAction('Use the code <code>' + code + '</code> to receive the file.', abort);
}

function actionReceive (code, config) {
	var abort;
	abort = receiveFile(code, config, function (file) {
		var url, name, link;
		if (file) {
			url = URL.createObjectURL(file);
			name = (file.name || '').replace(/&/g, '&amp;').replace(/"/g, '&quot;')
				.replace(/</g, '&lt;').replace(/>/g, '&gt;');
			link = '<a href="' + url + '" download="' + name  + '" target="_blank">' + (name || 'unnamed file') + '</a>';
			dom.files.innerHTML += '<li>' + link + '</li>';
		}
		finishAction(
			file ? 'File received, ready to save: ' + link : 'File not received',
			abort
		);
	});
	startAction('Waiting for file …', abort);
}

//Base send/receive
function sendBinary (url, data, callback) {
	var xhr = new XMLHttpRequest();
	xhr.onload = function () {
		callback(true);
	};
	xhr.onerror = function () {
		callback();
	};
	xhr.onabort = function () {
		callback();
	};
	xhr.open('POST', url, true);
	xhr.send(data);
	return function () {
		xhr.abort();
	};
}

function receiveBinary (url, callback) {
	var xhr = new XMLHttpRequest();
	xhr.onload = function () {
		callback(new Uint8Array(xhr.response));
	};
	xhr.onerror = function () {
		callback();
	};
	xhr.onabort = function () {
		callback();
	};
	xhr.open('GET', url, true);
	xhr.responseType = 'arraybuffer';
	xhr.send();
	return function () {
		xhr.abort();
	};
}

function runPipeline (pipeline, state, callback) {
	var abort;

	function workPipeline () {
		var f;
		if (pipeline.length === 0) {
			callback(state);
			return;
		}
		f = pipeline.shift();
		if (f.length < 2) {
			state = f(state);
			if (!state) {
				callback();
				return;
			}
			workPipeline();
			return;
		}
		abort = f(state, function (data) {
			if (!data) {
				callback();
				return;
			}
			state = data;
			workPipeline();
		});
	}

	workPipeline();
	return abort;
}

/*
For proper encryption we would need to do the following:
The sender has to
* after readFile initiate a public key exchange, adding some data to meta (including IV for encryption etc.)
* after sendMeta wait for the answer and construct the key from it
* then encrypt the data unsing that key

The receiver has to
* before receiveRawData continue the key exchange and construct the key
* at the start of buildFile decrypt the data

We also probably need some protection against MitM-attacks.
*/

//Send file
function readFile (state, callback) {
	var meta = {
		name: state.file.name,
		date: state.file.lastModified || Number(state.file.lastModifiedDate),
		path: getRandomPath(32),
		features: []
	}, reader = new FileReader(), i;
	if (isFFOS()) {
		//in some situations we get the full path
		i = meta.name.lastIndexOf('/');
		if (i !== -1) {
			meta.name = meta.name.slice(i + 1);
		}
	}
	reader.onload = function () {
		log('Reading done');
		state.meta = meta;
		state.data = new Uint8Array(reader.result);
		if (state.data.length === 0) {
			callback();
		} else {
			callback(state);
		}
	};
	reader.onerror = function () {
		log('Reading failed');
		callback();
	};
	reader.onabort = function () {
		log('Reading aborted');
		callback();
	};
	log('Start reading file');
	reader.readAsArrayBuffer(state.file);
	return function () {
		reader.abort();
	};
}

function shouldCompressData (config, name) {
	var pos, ext;
	if (!config.compress) {
		return false;
	}
	pos = name.lastIndexOf('.');
	if (pos === -1) {
		return true;
	}
	ext = name.slice(pos + 1).toLowerCase();
	return config.nocompress.toLowerCase().split(/\W+/).indexOf(ext) === -1;
}

function compressData (state) {
	log('Compressing data');
	var compressed = pako.deflateRaw(state.data);
	if (compressed.length < state.data.length) {
		state.data = compressed;
		state.meta.features.push('compression');
		state.meta.compression = 'deflate';
	} else {
		log('Continuing with uncompressed data');
	}
	return state;
}

function shouldObfuscateData (config) {
	return config.obfuscate;
}

function obfuscateData (state) {
	/*jshint bitwise: false*/
	var i, key = state.path.charCodeAt(0);
	log('Obfuscating data');
	for (i = 0; i < state.data.length; i++) {
		state.data[i] = state.data[i] ^ key;
	}
	state.meta.features.push('obfuscation');
	state.meta.obfuscation = 'xor';
	return state;
}

function encodeJSON (data) {
	return (new TextEncoder()).encode(JSON.stringify(data));
}

function sendMeta (state, callback) {
	var url = state.config.server + state.path;
	state.meta.size = state.data.length;
	log('Sending metadata');
	return sendBinary(url, encodeJSON(state.meta), function (success) {
		callback(success && state);
	});
}

function sendRawData (state, callback) {
	var url = state.config.server + state.meta.path;
	log('Sending data');
	return sendBinary(url, state.data, callback);
}

function sendFile (file, path, config, callback) {
	var pipeline = [];
	pipeline.push(readFile);
	if (shouldCompressData(config, file.name)) {
		pipeline.push(compressData);
	}
	if (shouldObfuscateData(config)) {
		pipeline.push(obfuscateData);
	}
	pipeline.push(sendMeta);
	pipeline.push(sendRawData);
	return runPipeline(pipeline, {file: file, path: path, config: config}, callback);
}

//Receive file
function decodeJSON (data) {
	try {
		return JSON.parse((new TextDecoder()).decode(data));
	} catch (e) {
	}
}

featureValidators = {
	compression: function (value) {
		return !value || value === 'deflate';
	},
	obfuscation: function (value) {
		return !value || value === 'xor';
	}
};

function validateMeta (meta) {
	var i, key, supportedFeatures = Object.keys(featureValidators);
	if (!meta) {
		log('No or unparsable metadata');
		return;
	}
	if (!meta.path || !(/^[a-zA-Z0-9_\-]+$/.test(meta.path))) {
		log('No or unexpected path in metadata');
		return;
	}
	if (!meta.size) {
		log('No size given in metadata');
		return;
	}
	if (!meta.features || !Array.isArray(meta.features)) {
		log('No indication of used features in metadata');
		return;
	}
	for (i = 0; i < meta.features.length; i++) {
		key = meta.features[i];
		if (supportedFeatures.indexOf(key) === -1) {
			log('Unsupported feature: ' + key);
			return;
		}
		if (!featureValidators[key](meta[key])) {
			log('Feature ' + key + ' with invalid or unsupported value');
			return;
		}
	}
	for (i = 0; i < supportedFeatures.length; i++) {
		key = supportedFeatures[i];
		if (meta.features.indexOf(key) === -1 && meta[key]) {
			log('Feature ' + key + ' used without indication');
			return;
		}
	}
	return true;
}

function receiveMeta (state, callback) {
	var url = state.config.server + state.path;
	log('Waiting for metadata');
	return receiveBinary(url, function (data) {
		var meta = decodeJSON(data);
		if (!validateMeta(meta)) {
			callback();
			return;
		}
		log('Metadata received and parsed');
		state.meta = meta;
		callback(state);
	});
}

function receiveRawData (state, callback) {
	var url = state.config.server + state.meta.path;
	log('Waiting for data');
	return receiveBinary(url, function (data) {
		if (!data || data.length !== state.meta.size) {
			log('Receiving data failed');
			callback();
			return;
		}
		log('Data received');
		state.data = data;
		callback(state);
	});
}

function uncompressData (state) {
	log('Uncompressing data');
	try {
		state.data = pako.inflateRaw(state.data);
	} catch (e) {
		log('Uncompressing failed');
		return;
	}
	return state;
}

function unobfuscateData (state) {
	/*jshint bitwise: false*/
	var key = state.path.charCodeAt(0), i;
	log('Unobfuscating data');
	for (i = 0; i < state.data.length; i++) {
		state.data[i] = state.data[i] ^ key;
	}
	return state;
}

function writeFile (state) {
	var options = {};
	log('Creating file');
	if (state.meta.date) {
		options.lastModified = state.meta.date;
	}
	if (isFFOS()) {
		//FFOS will create a mess when the type is not one it can open
		//so just claim it is an image. This usually reduces the mess
		//to be almost unnoticable.
		options.type = 'image/png';
	}
	return new File([state.data], state.meta.name || '', options);
}

function buildFile (state, callback) {
	var pipeline = [];
	if (state.meta.compression) {
		pipeline.push(uncompressData);
	}
	if (state.meta.obfuscation) {
		pipeline.push(unobfuscateData);
	}
	pipeline.push(writeFile);
	return runPipeline(pipeline, state, callback);
}

function receiveFile (path, config, callback) {
	var pipeline = [];
	pipeline.push(receiveMeta);
	pipeline.push(receiveRawData);
	pipeline.push(buildFile);
	return runPipeline(pipeline, {path: path, config: config}, callback);
}

//Init
function init () {
	var config;
	initDom();
	config = readConfig();
	initConfig(config);
	initButtons(config);
}

function initActivity () {
	var config;
	initDom();
	dom.main.hidden = true;
	config = readConfig();
	dom.abort.addEventListener('click', function () {
		window.close();
	});
	navigator.mozSetMessageHandler('activity', function (request) {
		var file = request.source.data.blobs[0];
		if (file && !file.name && request.source.data.filenames) {
			file.name = request.source.data.filenames[0] || '';
		}
		actionSend(file, config);
	});
}

if (location.search === '?mode=inline' && navigator.mozSetMessageHandler) {
	initActivity();
} else {
	init();
}
})();