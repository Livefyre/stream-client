"use strict";

/**
 * StreamClient - depends on SockJS-client, Livefyre/event-emitter, $.extend-fn (or similar API).
 * Implements the nodeJS stream.ReadableStream.pipe() and emits 'data', 'end', 'close', 'error'.
 */

module.exports = StreamClient;

var SockJS = require('sockjs-client');
var EventEmitter = require('events-event-emitter');
var extend = require('util-extend');

// A mini logger abstraction that leverages Chrome's [log|warn|error|debug] levels and falls back to
// console.log for the others or NOOP when no console exists at all
function mkLoggerIfNeeded(level) {
    if (console && console[level] && typeof console[level] == "function" && console[level].call) {
        return function() {
            if (console[level].apply) {
                console[level].apply(console, [].slice.call(arguments));
            } else if (console[level].call) {
                console[level]([].slice.call(arguments).join(" "));
            }
        }
    } else if (console && console.log) {
        var prefix = level.toUpperCase()+": ";
        return function() {
            console.log(prefix + [].slice.call(arguments).join(" "));
        }
    } else return function(){ /* NOOP Logging IE<=8, FF<=2 */ };
}
var logger = {
    debug: mkLoggerIfNeeded("debug"),
    info: mkLoggerIfNeeded("info"),
    log: mkLoggerIfNeeded("log"),
    warn: mkLoggerIfNeeded("warn"),
    error: mkLoggerIfNeeded("error")
};

var States = {
    DISCONNECTED : "DISCONNECTED",
    DISCONNECTING : "DISCONNECTING",
    CONNECTED : "CONNECTED",
    CONNECTING : "CONNECTING",
    RECONNECTING : "RECONNECTING",
    STREAMING : "STREAMING",
    REBALANCING : "REBALANCING",
    ERROR : "ERROR"
};

var environments = {
    qa: 'stream.qa-ext.livefyre.com',
    uat: 'stream.t402.livefyre.com',
    production: 'stream.livefyre.com'
};

var State = function State(initialState) {
    EventEmitter.call(this);
    this.value = initialState || States.DISCONNECTED;
};
State.prototype.change = function change(state) {
    var old = this.value;
    if (old !== state) {
        this.value = state;
        this.emit('change', old, state);
    }
};
extend(State.prototype, EventEmitter.prototype);

/**
 * Instantiates a Stream v4 client that is responsible for service discovery, login, connecting
 * and streaming events for a given stream. The client will emit messages 'start', 'data', 'end', 'close', 'error'.
 * @param options - Map containing hostname and optionally protocol, port and endpoint; retry and retryTimeout; debug
 * @constructor
 */
function StreamClient(options) {
    EventEmitter.call(this);
    this.options = extend({}, options); // Clone
    this.options.debug = this.options.debug || false;
    this.options.retry = this.options.retry || 10; // Try to (re)connect 10 times before giving up
    // Retry after: (1 + retry^2) * retryTimeout ms, with 10 retries ~= 3 min
    this.options.retryTimeout = this.options.retryTimeout !== undefined ? this.options.retryTimeout : 500;
    this.options.protocol = this.options.protocol || window.location.protocol;
    if (this.options.protocol.slice(-1) !== ':') {
        this.options.protocol += ':';
    }
    this.options.port = Number(this.options.port);
    if (!this.options.port) {
        if (this.options.protocol === "http:") {
            this.options.port = 80
        } else if (this.options.protocol === "https:") {
            this.options.port = 443
        } else {
            throw new Error("Invalid protocol and port");
        }
    }
    this.options.endpoint = this.options.endpoint || '/stream';
    if (!this.options.hostname && options.environment) {
        this.options.hostname = environments[options.environment];
    }
    if (!this.options.hostname) {
        throw new Error("Stream Hostname is required");
    }

    // SockJS - Stream Connection
    this.lfToken = null;
    this.conn = null;
    this.lastError = null;
    this.retryCount = 0;
    this.rebalancedTo = null;
    this.allProtocols = Object.keys(SockJS.getUtils().probeProtocols());
    this.allProtocolsWithoutWS = this.allProtocols.slice();
    this.allProtocolsWithoutWS.splice(this.allProtocols.indexOf("websocket"),1);
    this.streams = {};
    // Stream State
    this.States = States; // Make accessible for testing
    this.state = new State(States.DISCONNECTED);
    this.state.on("change", this._stateChangeHandler.bind(this));
}
extend(StreamClient.prototype, EventEmitter.prototype);

/**
 * @private
 */
StreamClient.prototype._stateChangeHandler = function _stateChangeHandler(oldState, newState) {
    if (this.options.debug) logger.debug("DEBUG", oldState, ">>", newState);
    if (newState == States.CONNECTING || newState == States.RECONNECTING) {
        var connect = function () {
            var opts = {
                debug: this.options.debug,
                protocols_whitelist: this.rebalancedTo ? this.allProtocols : this.allProtocolsWithoutWS
            };
            this.conn = new SockJS(this._streamUrl(), undefined, opts);
            this._connectListeners();
            this.retryCount++;
        }.bind(this);
        if (newState == States.CONNECTING) // sync, easier for testing
            connect();
        else
            setTimeout(connect, (Math.pow(this.retryCount, 2) + 1) * this.options.retryTimeout);
    }
    if (newState == States.DISCONNECTING) {
        if (oldState == States.STREAMING) {
            this._sendControlMessage({ action: "disconnect" })
        } else {
            this.conn.close()
        }
    }
    if (newState == States.DISCONNECTED) {
        this.conn = null;
        if (oldState == States.DISCONNECTING) {
            Object.keys(this.streams).forEach(function(urn){
                var subscription = this.streams[urn];
                subscription.close();
            }.bind(this))
            this.emit("end");
            this.emit("close");
        } else if (oldState == States.REBALANCING) {
            // this is OK we need to connect to another host
            this.state.change(States.RECONNECTING);
        } else {
            if (oldState == States.CONNECTING || oldState == States.RECONNECTING) {
                this.lastError = new Error("Failed to connect #" + this.retryCount +
                    ", bad address or service down: " + this._streamUrl());
                logger.warn(this.lastError.message);
            } else if (oldState == States.CONNECTED || oldState == States.STREAMING) {
                this.lastError = new Error("Connection dropped, attempting to reconnect to: " + this._streamUrl());
                logger.warn(this.lastError.message);
            }
            if (this.retryCount < this.options.retry) {
                this.state.change(States.RECONNECTING);
            } else {
                this.lastError = new Error("Connect retries exceeded, bad address or server down: " + this._streamUrl());
                logger.error(this.lastError.message)
                this.state.change(States.ERROR);
            }
        }
    }
    if (newState == States.CONNECTED) {
        this._ensureSubscriptionState();
    }
    if (newState == States.REBALANCING) {
        logger.log("Rebalancing for Streams:", Object.keys(this.streams), "at", this._streamUrl());
        this.retryCount = 0;
    }
    if (newState == States.STREAMING) {
        this.retryCount = 0;
        this.emit("start");
    }
    if (newState == States.ERROR) { // lfToken or streamId invalid, drop the connection, or when connection fails
        this.emit("error", this.lastError);
        if (oldState == States.STREAMING) {
            this.conn.close();
        } else {
            this.state.change(States.DISCONNECTED);
        }
    }
};

StreamClient.prototype._ensureSubscriptionState = function _ensureSubscriptionState() {
    var keys = Object.keys(this.streams);
    if (keys.length == 0 && this.state.value != States.DISCONNECTED) {
        this.state.change(States.DISCONNECTING);
    } else if (keys.length > 0 && this.state.value == States.DISCONNECTED) {
        this.state.change(States.CONNECTING);
    } else if (this.state.value == States.CONNECTED || this.state.value == States.STREAMING) {
        this._sendControlMessage({
            action: "subscribe",
            hostname: this._streamHost(),
            lfToken: this.lfToken,
            streams: this._streamsJSON()
        });
    }
};

/**
 * @returns [Object] the streams section of the subscription message (array)
 * @private
 */
StreamClient.prototype._streamsJSON = function _streamsJSON() {
    var streamsJSON = [];
    Object.keys(this.streams).forEach(function(urn){
        var subscription = this.streams[urn];
        streamsJSON.push(subscription._formatJSON());
    }.bind(this));
    return streamsJSON;
};

/**
 * @returns {String} the composed stream URL
 * @private
 */
StreamClient.prototype._streamUrl = function _streamUrl() {
    // don't append :80 for http, IE trips over that
    var portSuffix = ((this.options.protocol === "http:" && this.options.port === 80) ? '' : ':' + this.options.port);
    return this.options.protocol + '//' + this._streamHost() + portSuffix + this.options.endpoint;
};

/**
 * @returns {String} the stream host
 * @private
 */
StreamClient.prototype._streamHost = function _streamHost() {
    return (this.retryCount < 3 && this.rebalancedTo) || this.options.hostname;
};

/**
 * @private
 */
StreamClient.prototype._onControlMessage = function _onControlMessage(message) {
    if (message.action == "subscribed") {
        this.state.change(States.STREAMING);
    }
    if (message.action == "rebalance") {
        this.rebalancedTo = message.hostname;
        this.state.change(States.REBALANCING);
    }
    if (message.action == "rewindFailed") {
        logger.warn("StreamClient failed to rewind stream:", message.streamId);
        var stream = this.streams[message.streamId];
        if (stream) {
            stream._onError(message.error);
        }
    }
    if (message.action == "authFailed") {
        logger.warn("StreamClient failed to authorize stream:", message.streamId);
        var stream = this.streams[message.streamId];
        if (stream) {
            stream._onError(message.error);
        }
    }
    if (message.action == "error") {
        logger.error("StreamClient error, disconnecting, reason:", message.error);
        this.lastError = new Error(message.error);
        this.state.change(States.ERROR);
    }
};

/**
 * @private
 */
StreamClient.prototype._sendControlMessage = function _sendControlMessage(message) {
    if (!this.conn) {
        throw new Error("Can't send control message, not connected: " + this.state.value);
    }
    var ctrlMsg = {
        protocol: "V1",
        topic: "control",
        body: message
    };
    if (this.options.debug) logger.debug("Sending msg", ctrlMsg)
    this.conn.send(JSON.stringify(ctrlMsg))
}

/**
 * @param {LFToken} lfToken - the LF-Token which contains the JID to be used
 */
StreamClient.prototype.auth = function auth(lfToken) {
    this.lfToken = lfToken;
}

StreamClient.prototype._truncUrnClassifier = function _truncUrnClassifier(urn) {
    return urn.replace(/:(topicStream|personalStream|collectionStream)/, "");
}

/**
 * @param urn Full URN with classifier of the stream
 * @param eventId
 * @returns {StreamSubscription}
 */
StreamClient.prototype.subscribe = function subscribe(urn, eventSequence, eventId) {
    var urnUnClassified = this._truncUrnClassifier(urn);
    if (this.streams[urnUnClassified]) {
        return this.streams[urnUnClassified];
    }
    logger.log("Subscribing to Stream:", urn, "at", this._streamUrl())
    var streamSubscription = new StreamSubscription(this, urn, eventSequence, eventId);
    this.streams[urnUnClassified] = streamSubscription;
    this.rebalancedTo = null;
    this._ensureSubscriptionState();
    return streamSubscription;
};

/**
 * @param urn Full URN with classifier of the stream
 */
StreamClient.prototype._unsubscribe = function _unsubscribe(urn) {
    logger.log("Unsubscribing from Stream:", urn);
    var urnUnClassified = this._truncUrnClassifier(urn);
    delete this.streams[urnUnClassified];
    this._ensureSubscriptionState();
};

/**
 * @private
 */
StreamClient.prototype._connectListeners = function _connectListeners() {
    var self = this;
    self.conn.onopen = function(){
        self.state.change(States.CONNECTED);
    };
    self.conn.onclose = function(){
        self.state.change(States.DISCONNECTED);
    };
    self.conn.onmessage = function(sockjsMsg){
        var msg;
        try {
            msg = JSON.parse(sockjsMsg.data);
        } catch (e) {
            self.emit("error", new Error("Invalid JSON in message: " + sockjsMsg.data));
            return;
        }
        if (self.options.debug) logger.debug("Received msg", msg);
        if (msg.topic == "control") {
            self._onControlMessage(msg.body);
        } else if (msg.topic == "stream") {
            if (self.state.value != States.STREAMING) {
                logger.warn("Unexpected stream message for state ", self.state.value);
            }
            var stream = self.streams[msg.streamId];
            stream && stream._onMessage(msg.sequence, msg.eventId, msg.body);
            self.emit("data", msg.body);
        } else {
            self.emit("error", new Error("Unsupported message received: " + JSON.stringify(msg)));
        }
    }
};

/**
 * Disconnects from the stream, closing the session on the stream server.
 */
StreamClient.prototype.disconnect = function disconnect() {
    if (!this.conn) {
        logger.warn("StreamClient not connected")
    } else {
        logger.log("Disconnecting from Stream at ", this._streamUrl());
        this.state.change(States.DISCONNECTING);
    }
};

function StreamSubscription(client, streamId, eventSequence, eventId) {
    this._client = client;
    this.streamId = streamId;
    this.sequence = eventSequence === undefined ? null : eventSequence;
    this.eventId = eventId === undefined ? null : eventId;

    // ReadableStream.pipe support
    this.paused = false;
    this._listeners = []; // Bug in event-emitter
    this.pipeHandlers = [];
    this._setupPipeHandlers('data');
    this._setupPipeHandlers('end');
}
extend(StreamSubscription.prototype, EventEmitter.prototype);

StreamSubscription.prototype._onError = function _onError(errorMessage) {
    this.sequence = null;
    this.eventId = null;
    this.emit('error', new Error(errorMessage));
};

StreamSubscription.prototype._onMessage = function _onMessage(sequence, eventId, messageBody) {
    if (this.sequence === null || sequence === this.sequence + 1) {
        // normal sequence
        this.sequence = sequence;
        this.eventId = eventId;
        this.emit('data', {
            eventSequence: sequence,
            eventId: eventId,
            event: messageBody
        });
    } else if (sequence <= this.sequence) {
        // ignore repeated values
        logger.warn("Dropping repeated message seq:", sequence, "id:", eventId);
    } else {
        logger.error("Message(s) lost in flight, rewinding from seq:", this.sequence);
        this._client._sendControlMessage({
            action: "rewind",
            host: this._client._streamHost(),
            lfToken: this._client.lfToken,
            streams: [
                this._formatJSON()
            ]
        });
    }
};

StreamSubscription.prototype._formatJSON = function _formatJSON() {
    return {
        streamId: this.streamId,
        resumeTime: this.eventId,
        resumeSeq: this.sequence
    };
}

StreamSubscription.prototype.close = function close() {
    this.emit('end');
    this._client._unsubscribe(this.streamId);
};

// === begin === node stream.Readable API

StreamSubscription.prototype._setupPipeHandlers = function _setupPipeHandlers(handlerType) {
    var buffer = [];
    var writeOut = function writeOut(data) {
        this.pipeHandlers.forEach(function(pipe) {
            try {
                pipe[handlerType](data);
            } catch (e) {
                logger.error("StreamClient: Error calling handler for", handlerType, e)
            }
        }.bind(this));
    }.bind(this);
    this.on("resumed", function resume(){
        while(buffer.length > 0) {
            writeOut(buffer.shift())
        }
    });
    this.on(handlerType, function(data){
        if (this.paused) {
            buffer.push(data);
        } else {
            writeOut(data);
        }
    }.bind(this));
};
StreamSubscription.prototype.resume = function resume() {
    this.emit("resumed");
    this.paused = false;
};
StreamSubscription.prototype.pause = function pause() {
    this.paused = true;
};
StreamSubscription.prototype.pipe = function pipe(dest, opts) {
    opts = opts || { end: true };
    var pipeHandler = {
        dest: dest,
        end: function() {
            if (!opts.end === false) {
                dest.end();
            }
        },
        data: function(msg) {
            dest.write(msg)
        }
    };
    this.pipeHandlers.push(pipeHandler);
    return dest;
};
StreamSubscription.prototype.unpipe = function unpipe(dest) {
    if (!dest) {
        this.pipeHandlers = [];
    } else {
        var pipeIdx;
        for (var i = 0; i < this.pipeHandlers.length; i++) {
            if (this.pipeHandlers[i].dest === dest) {
                pipeIdx = i;
            }
        }
        if (pipeIdx === undefined) {
            throw new Error("Destination not registered")
        }
        this.pipeHandlers.splice(pipeIdx, 1);
    }
};
StreamSubscription.prototype.read = function read(size) { throw new Error("Not implemented"); };
StreamSubscription.prototype.setEncoding = function setEncoding(encoding) { throw new Error("Not implemented"); };
StreamSubscription.prototype.unshift = function unshift(chunk) { throw new Error("Not implemented"); }
StreamSubscription.prototype.wrap = function wrap(stream) { throw new Error("Not implemented"); }

// === end === node stream.Readable API
