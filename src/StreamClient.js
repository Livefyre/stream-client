"use strict";

/**
 * StreamClient - depends on SockJS-client, Livefyre/event-emitter, $.extend-fn (or similar API).
 * Implements the nodeJS stream.ReadableStream.pipe() and emits 'data', 'end', 'close', 'error'.
 */
define(['SockJS', 'event-emitter', 'extend'], function (SockJS, EventEmitter, extend) {

    var States = {
        DISCONNECTED : "DISCONNECTED",
        DISCONNECTING : "DISCONNECTING",
        CONNECTED : "CONNECTED",
        CONNECTING : "CONNECTING",
        RECONNECTING : "RECONNECTING",
        STREAMING : "STREAMING",
        REBALANCING : "REBALANCING",
        ERROR : "ERROR"
    }
    var State = function State(initialState) {
        EventEmitter.call(this);
        this.value = initialState || States.DISCONNECTED;
    }
    State.prototype.change = function change(state) {
        var old = this.value
        if (old !== state) {
            this.value = state
            this.emit('change', old, state);
        }
    }
    extend(State.prototype, EventEmitter.prototype);

    /**
     * Instantiates a Stream v4 client that is responsible for service discovery, login, connecting
     * and streaming events for a given stream. The client will emit messages 'start', 'data', 'end', 'close', 'error'
     * @param options - Map containing streamUrl and chronosUrl
     * @constructor
     */
    var StreamClient = function StreamClient(options) {
        EventEmitter.call(this);
        this.options = extend({}, options); // Clone
        this.options.retry = this.options.retry || 10; // Try to (re)connect 10 times before giving up
        // Retry after: (1 + retry^2) * retryTimeout ms, with 10 retries ~= 3 min
        this.options.retryTimeout = this.options.retryTimeout !== undefined ? this.options.retryTimeout : 500;

        // SockJS - Stream Connection
        this.lfToken = null;
        this.streamId = null;
        this.sessionId = null;
        this.conn = null;
        this.lastError = null;
        this.retryCount = 0;

        // Stream State
        this.States = States; // Make accessible for testing
        this.state = new State(States.DISCONNECTED);
        this.state.on("change", this._stateChangeHandler.bind(this));

        // ReadableStream.pipe support
        this.pipeHandlers = [];
        this._setupPipeHandlers('data');
        this._setupPipeHandlers('end');
    }
    extend(StreamClient.prototype, EventEmitter.prototype);

    /**
     * @private
     */
    StreamClient.prototype._setupPipeHandlers = function _setupPipeHandlers(handlerType) {
        this.on(handlerType, function(data){
            this.pipeHandlers.forEach(function(pipe) {
                try {
                    pipe[handlerType](data);
                } catch (e) {
                    console.error("StreamClient: Error calling handler for", handlerType, e)
                }
            }.bind(this));
        }.bind(this))
    }

    /**
     * @private
     */
    StreamClient.prototype._stateChangeHandler = function _stateChangeHandler(oldState, newState) {
        console.debug(oldState, ">>", newState)
        if (newState == States.CONNECTING || newState == States.RECONNECTING) {
            var connect = function () {
                this.conn = new SockJS(this.options.streamUrl, undefined, { debug: true });
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
            }
            this.conn.close()
        }
        if (newState == States.DISCONNECTED) {
            this.conn = null;
            if (oldState == States.DISCONNECTING) {
                this.sessionId = null;
            }
            if (oldState == States.DISCONNECTING || oldState == States.ERROR) {
                this.emit("end");
                this.emit("close");
            } else if (oldState == States.REBALANCING) {
                // this is OK we need to connect to another host
                this.state.change(States.RECONNECTING);
            } else {
                if (oldState == States.CONNECTING || oldState == States.RECONNECTING) {
                    this.lastError = new Error("Failed to connect #" + this.retryCount +
                        ", bad address or service down: " + this.options.streamUrl);
                    console.warn(this.lastError.message);
                } else if (oldState == States.CONNECTED || oldState == States.STREAMING) {
                    this.lastError = new Error("Connection dropped, attempting to reconnect to: " + this.options.streamUrl);
                    console.warn(this.lastError.message);
                }
                if (this.retryCount < this.options.retry) {
                    this.state.change(States.RECONNECTING);
                } else {
                    this.lastError = new Error("Connect retries exceeded, bad address or server down: " + this.options.streamUrl);
                    console.error(this.lastError.message)
                    this.state.change(States.ERROR);
                }
            }
        }
        if (newState == States.CONNECTED) {
            this.retryCount = 0;
            this._sendControlMessage({
                action: "subscribe",
                lfToken: this.lfToken,
                streamId: this.streamId,
                sessionId: this.sessionId
            });
        }
        if (newState == States.REBALANCING) {
            this.conn.close();
        }
        if (newState == States.STREAMING) {
            this.emit("start");
        }
        if (newState == States.ERROR) { // lfToken or streamId invalid, drop the connection, or when connection fails
            this.emit("error", this.lastError);
            if (oldState == States.CONNECTED || oldState == States.STREAMING) {
                this.conn.close();
            } else {
                this.state.change(States.DISCONNECTED);
            }
        }
    }

    /**
     * @private
     */
    StreamClient.prototype._onControlMessage = function _onControlMessage(message) {
        if (message.action == "subscribed") {
            this.sessionId = message.sessionId;
            this.state.change(States.STREAMING);
        }
        if (message.action == "rebalance") {
            this.options.streamUrl = message.streamUrl;
            this.state.change(States.REBALANCING);
        }
        if (message.action == "error") {
            console.error("StreamClient error, disconnecting, reason:", message.error);
            this.lastError = new Error(message.error);
            this.state.change(States.ERROR);
        }
    }

    /**
     * @private
     */
    StreamClient.prototype._sendControlMessage = function _sendControlMessage(message) {
        if (!this.conn) {
            throw new Error("Can't send control message, not connected");
        }
        var ctrlMsg = {
            topic: "control",
            body: message
        };
        console.debug("Sending msg", ctrlMsg)
        this.conn.send(JSON.stringify(ctrlMsg))
    }

    /**
     * Connects to the Stream.
     * @param {LFToken} lfToken - the LF-Token which contains the JID to be used
     * @param {String} streamId - the ID of the stream
     */
    StreamClient.prototype.connect = function connect(lfToken, streamId) {
        if (this.conn) {
            throw new Error("StreamClient already connected");
        }
        if (!(lfToken && streamId)) {
            throw new Error("lfToken and streamId are mandatory");
        }
        console.log("Connecting to Stream:", streamId, "at", this.options.streamUrl)
        this.lfToken = lfToken;
        this.streamId = streamId;
        this.state.change(States.CONNECTING);
    }

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
            console.debug("Received msg", msg);
            if (msg.topic == "control") {
                self._onControlMessage(msg.body);
            } else if (msg.topic == "stream") {
                if (self.state.value != States.STREAMING) {
                    console.warn("Unexpected stream message for state ", self.state.value);
                }
                self.emit("data", msg.body);
            } else {
                self.emit("error", new Error("Unsupported message received: " + JSON.stringify(msg)));
            }
        }
    }

    /**
     * Disconnects from the stream, closing the session on the stream server.
     */
    StreamClient.prototype.disconnect = function disconnect() {
        if (!this.conn) {
            throw new Error("StreamClient not connected")
        }
        console.log("Disconnecting from Stream at ", this.options.streamUrl)
        this.state.change(States.DISCONNECTING);
    }

    // === begin === node stream.Readable API

    StreamClient.prototype.read = function read(size) { throw new Error("Not implemented"); }
    StreamClient.prototype.setEncoding = function setEncoding(encoding) { throw new Error("Not implemented"); }
    StreamClient.prototype.resume = function resume() { throw new Error("Not implemented"); }
    StreamClient.prototype.pause = function pause() { throw new Error("Not implemented"); }
    StreamClient.prototype.pipe = function pipe(dest, opts) {
        opts = opts || { end: true }
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
        return dest
    }
    StreamClient.prototype.unpipe = function unpipe(dest) {
        if (!dest) {
            this.pipeHandlers = []
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
    }
    StreamClient.prototype.unshift = function unshift(chunk) { throw new Error("Not implemented"); }
    StreamClient.prototype.wrap = function wrap(stream) { throw new Error("Not implemented"); }

    // === end === node stream.Readable API

    return StreamClient;
});