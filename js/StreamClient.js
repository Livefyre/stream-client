"use strict";

/**
 * StreamClient - depends on SockJS-client, Lifefyre/event-emitter, $.extend-fn (or similar API).
 * Implements the nodeJS stream.ReadableStream.pipe() and emits 'data', 'end', 'close', 'error'.
 */
define(['SockJS', 'event-emitter', '$extend'], function (SockJS, EventEmitter, $extend) {

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
        this.value = initialState || States.DISCONNECTED;
        // EventEmitter
        this._listeners = {};
    }
    State.prototype.change = function change(state) {
        var old = this.value
        if (old !== state) {
            this.value = state
            this.emit('change', old, state);
        }
    }
    EventEmitter.call(State);
    $extend(State.prototype, EventEmitter.prototype);

    /**
     * Instanciates a Stream v4 client that is responsible for service discovery, login, connecting
     * and streaming events for a given stream. The client will emit messages 'start', 'data', 'end', 'close', 'error'
     * @param options - Map containing streamURL and chronosURL
     * @constructor
     */
    var StreamClient = function StreamClient(options) {
        this.options = options;

        // EventEmitter
        this._listeners = {};

        // SockJS - Stream Connection
        this.lfToken = null;
        this.streamId = null;
        this.sessionId = null;
        this.conn = null;
        this.lastError = null;

        // Stream State
        this.States = States; // Make accessible for testing
        this.state = new State(States.DISCONNECTED);
        this.state.on("change", this._stateChangeHandler.bind(this));

        // ReadableStream.pipe support
        this.pipeHandlers = {};
        this._setupPipeHandlers('data');
        this._setupPipeHandlers('end');
    }
    EventEmitter.call(StreamClient);
    $extend(StreamClient.prototype, EventEmitter.prototype);

    /**
     * @private
     */
    StreamClient.prototype._setupPipeHandlers = function _setupPipeHandlers(handlerType) {
        this.on(handlerType, function(data){
            for (pipe in Object.keys(self.pipeHandler)) {
                try {
                    this.pipeHandler[pipe][handlerType](data);
                } catch (e) {
                    console.error("StreamClient: Error calling handler", e)
                }
            }
        })
    }

    /**
     * @private
     */
    StreamClient.prototype._stateChangeHandler = function _stateChangeHandler(oldState, newState) {
        if (newState == States.CONNECTING || newState == States.RECONNECTING) {
            this.conn = new SockJS(this.options.streamUrl, undefined, { debug: true });
            this._connectListeners();
        }
        if (newState == States.DISCONNECTING) {
            if (oldState == States.STREAMING) {
                this._sendControlMessage({ action: "disconnect" })
            }
            this.conn.close()
        }
        if (newState == States.DISCONNECTED) {
            if (oldState == States.DISCONNECTING || oldState == States.ERROR) {
                this.conn = null;
                this.emit("end");
                this.emit("close");
            } else if (oldState == States.REBALANCING) {
                // this is OK we need to connect to the new host
            } else {
                this.state.change(States.RECONNECTING);
            }
        }
        if (newState == States.CONNECTED) {
            this._sendControlMessage({
                action: "subscribe",
                lfToken: this.lfToken,
                streamId: this.streamId
            });
        }
        if (newState == States.REBALANCING) {
            this.conn.close();
            this.state.change(States.RECONNECTING);
        }
        if (newState == States.ERROR) { // lfToken or streamId invalid, drop the connection
            this.emit("error", this.lastError);
            this.conn.close();
        }
    }

    /**
     * @private
     */
    StreamClient.prototype._onControlMessage = function _onControlMessage(message) {
        if (message.action == "subscribed") {
            this.state.change(States.STREAMING);
        }
        if (message.action == "rebalance") {
            this.options.streamUrl = message.streamUrl;
            this.state.change(States.REBALANCING);
        }
        if (message.action == "error") {
            console.error("StreamClient error, disconnecting, reason:", message.error);
            this.lastError = message.error;
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
        this.conn.send(ctrlMsg)
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
        self.conn.onmessage = function(msg){
            if (msg.topic == "control") {
                self._onControlMessage(msg.body);
            } else if (msg.topic == "stream") {
                self.emit("data", msg.body);
            } else {
                throw new Error("Unsupported message received");
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

    // === begin === node streams.ReadStream API

    StreamClient.prototype.read = function read(size) { throw new Error("Not implemented"); }
    StreamClient.prototype.setEncoding = function setEncoding(encoding) { throw new Error("Not implemented"); }
    StreamClient.prototype.resume = function resume() { throw new Error("Not implemented"); }
    StreamClient.prototype.pause = function pause() { throw new Error("Not implemented"); }
    StreamClient.prototype.pipe = function pipe(dest, opts) {
        opts = opts || { end: true }
        var pipeHandlers = {
            end: function() {
                if (!opts.end === false) {
                    dest.end();
                }
            },
            data: function(msg) {
                dest.write(msg)
            }
        };
        return dest
    }
    StreamClient.prototype.unpipe = function unpipe(dest) {
        if (!dest) {
            this.pipeHandlers = {}
        } else {
            if (this.pipeHandlers[dest]) {
                delete this.pipeHandlers[dest]
            }
        }
    }
    StreamClient.prototype.unshift = function unshift(chunk) { throw new Error("Not implemented"); }
    StreamClient.prototype.wrap = function wrap(stream) { throw new Error("Not implemented"); }

    // === end === node streams.ReadStream API

    return StreamClient;
});
