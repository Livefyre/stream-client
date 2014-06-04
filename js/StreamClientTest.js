"use strict";

// SockJS mock
define('SockJS', ['jasmine', '$extend'], function(jasmine, $extend){
    jasmineRequire.base(jasmine)
    function SockJSMock() {
        this._args = arguments;
        this.send = function () {
            if (SockJSMock.prototype._onSendCallBack) {
                SockJSMock.prototype._onSendCallBack.apply(this, arguments)
            }
        }.bind(this)
        this.close = function () {
            setTimeout(function () {
                if (this.onclose) { // SockJS API
                    this.onclose();
                }
            }.bind(this), 0)
            if (SockJSMock.prototype._onCloseCallBack) {
                SockJSMock.prototype._onCloseCallBack(this);
            }
        }.bind(this);
        setTimeout(function(){ // The connect logic
            if (this._args[0] == "http://non.existent.domain.com/stream") { // Simulate a failing connection
                this.close()
            } else if (this.onopen) { // SockJS API
                this.onopen();
            }
        }.bind(this), 0);
        if (SockJSMock.prototype._onNewCallBack) {
            SockJSMock.prototype._onNewCallBack.apply(this, this._args)
        }
    }
    SockJSMock.prototype._mockReset = function() {
        SockJSMock.prototype._onNewCallBack = null;
        SockJSMock.prototype._onSendCallBack = null;
        SockJSMock.prototype._onCloseCallBack = null;
    }
    SockJSMock.prototype._mockOnNew = function (onNewCallBack) {
        SockJSMock.prototype._onNewCallBack = onNewCallBack;
    }
    SockJSMock.prototype._mockOnClose = function (onCloseCallBack) {
        SockJSMock.prototype._onCloseCallBack = onCloseCallBack;
    }
    SockJSMock.prototype._mockOnSend = function (onSendCallBack) {
        SockJSMock.prototype._onSendCallBack = onSendCallBack;
    }
    SockJSMock.prototype._mockReply = function (msg) {
        if (this.onmessage) {
            this.onmessage(msg);
        }
    }
    return SockJSMock;
})

// StreamClient test specs
define(['StreamClient', 'SockJS'], function(StreamClient, SockJSMock){

    jasmineRequire.base(jasmine)
    jasmine.DEFAULT_TIMEOUT_INTERVAL = 2000

    describe('StreamClient', function(){

        var opts = {
            streamUrl: 'http://unit.test/stream',
            chronosUrl: 'http://unit.test/chronos',
            retry: 3, // Reduced number for tests
            retryTimeout: 0 // For testing disable exponentially increasing long timeouts
        }
        var lfToken = "someBase64EncodedToken";
        var streamId = "urn:livefyre:cnn.fyre.co:user=user4996";

        describe('should', function(){

            it("be a function", function(){
                expect(typeof StreamClient).toEqual("function");
            });

            it("start in disconnected state", function(){
                var sc = new StreamClient(opts)
                expect(sc.state.value).toBe(sc.States.DISCONNECTED)
            });

            it("try to connect via SockJS on connect", function(){
                var sc = new StreamClient(opts);
                expect(sc.state.value).toBe(sc.States.DISCONNECTED);
                sc.connect(lfToken, streamId);
                expect(sc.state.value).toBe(sc.States.CONNECTING);
                expect(sc.conn).toBeDefined();
            })

            it("expect a LFToken and streamId on connect", function(){
                var sc = new StreamClient(opts);
                expect(function(){ sc.connect()                 }).toThrow()
                expect(function(){ sc.connect(lfToken)          }).toThrow()
                expect(function(){ sc.connect(null, streamId)   }).toThrow()
                expect(function(){ sc.connect(null, null)       }).toThrow()
            })

            it("connect only when disconnected", function(done) {
                var sc = new StreamClient(opts);
                sc.connect(lfToken, streamId)
                setTimeout(function(){
                    expect(function(){ sc.connect(lfToken, streamId) }).toThrow()
                    done()
                },0)
            })

            it("disconnect only when connected", function(){
                var sc = new StreamClient(opts);
                expect(sc.state.value).toBe(sc.States.DISCONNECTED);
                expect(function(){ sc.disconnect() }).toThrow();
            });
        })

        describe("when connected should", function(){

            var sc;
            var connect;
            beforeEach(function(){
                SockJSMock.prototype._mockReset();
                sc = new StreamClient(opts);
                connect = function() { sc.connect(lfToken, streamId); }
            })

            it("send a subscribe action to stream", function(done){

                SockJSMock.prototype._mockOnSend(function(msg){
                    expect(msg).toEqual(JSON.stringify({
                        topic:"control",
                        body: {
                            action: "subscribe",
                            lfToken: lfToken,
                            streamId: streamId,
                            sessionId: null
                        }
                    }));
                    done()
                })

                connect();
            })

            it("handle an auth failure on subscribe", function(done){

                SockJSMock.prototype._mockOnSend(function(msg) {
                    msg = JSON.parse(msg)
                    if (msg.topic == "control" && msg.body.action == "subscribe") {
                        var serverResponse = JSON.stringify({
                            topic: "control",
                            body: { action: "error", error: "User unknown"}
                        });
                        this._mockReply({ data: serverResponse });
                    }
                })

                sc.on("error", function(message){
                    expect(message).toEqual(new Error("User unknown"));
                    done();
                })

                connect();
            });

            it("handle a failure on subscribe", function(done){

                SockJSMock.prototype._mockOnSend(function(msg){
                    msg = JSON.parse(msg)
                    if (msg.topic == "control" && msg.body.action == "subscribe") {
                        var serverResponse = JSON.stringify({
                            topic: "control",
                            body: { action: "error", error: "User not authorized or stream unknown"}
                        });
                        this._mockReply({ data: serverResponse });
                    }
                });

                sc.on("error", function(message){
                    expect(message).toEqual(new Error("User not authorized or stream unknown"));
                    done();
                })

                connect();

            });

            it("handle rebalance command", function(done){

                var urls = [];

                SockJSMock.prototype._mockOnNew(function (url) {
                    urls.push(url);
                });

                SockJSMock.prototype._mockOnSend(function (msg) {
                    msg = JSON.parse(msg)
                    if (msg.topic == "control" && msg.body.action == "subscribe") {
                        var serverResponse;
                        if (urls.length == 1) {
                            serverResponse = JSON.stringify({
                                topic: "control",
                                body: {
                                    action: "rebalance",
                                    streamUrl: "http://rebalance.unit.test/stream" }
                            });
                        } else {
                            serverResponse = JSON.stringify({
                                topic: "control",
                                body: { action: "subscribed" }
                            });
                        }
                        this._mockReply({ data: serverResponse });
                    }
                });

                sc.on("start", function () {
                    try {
                        expect(urls.length).toBe(2);
                        expect(urls[0]).toBe("http://unit.test/stream");
                        expect(urls[1]).toBe("http://rebalance.unit.test/stream");
                        expect(sc.state.value).toBe(sc.States.STREAMING); // now in streaming state
                        done();
                    } catch (e) {
                        console.error(e)
                    }
                });

                connect();
            });

            it("reconnect 3 times when the connection dies, before sending 'end' and 'close' events", function(done){

                var attempts = 0;
                SockJSMock.prototype._mockOnNew(function(){
                    attempts++;
                });

                SockJSMock.prototype._mockOnSend(function(msg){
                    msg = JSON.parse(msg)
                    if (msg.topic == "control" && msg.body.action == "subscribe") {
                        var serverResponse = JSON.stringify({
                            topic: "control",
                            body: { action: "subscribed" }
                        });
                        this._mockReply({ data: serverResponse });
                    }
                });

                var spyListener = jasmine.createSpyObj("spyListener", [ "end", "close", "error"])
                sc.on("end", spyListener.end);
                sc.on("close", spyListener.close);
                sc.on("error", spyListener.error);

                // cause trouble
                sc.on("start", function(){
                    sc.options.streamUrl = "http://non.existent.domain.com/stream"
                    sc.conn.close();
                });

                setTimeout(function(){
                    expect(sc.state.value).toBe(sc.States.DISCONNECTED);
                    expect(attempts).toBe(4); // 1 connect + 3 failed connects
                    expect(spyListener.end.calls.count()).toEqual(1);
                    expect(spyListener.close.calls.count()).toEqual(1);
                    expect(spyListener.error.calls.count()).toEqual(1);
                    done();
                }, 100);

                connect();
            })

            describe("support node stream.Readable API", function(){

                it("events: 'start', 'data', 'end', 'close'", function(done){

                    var disconnectCalled = false
                    SockJSMock.prototype._mockOnSend(function(msg){
                        msg = JSON.parse(msg)
                        if (msg.topic == "control" && msg.body.action == "subscribe") {
                            this._mockReply({ data: JSON.stringify({ topic: "control", body: { action: "subscribed" } }) })
                            this._mockReply({ data: JSON.stringify({ topic: "stream", body: { event: 1 } }) })
                            this._mockReply({ data: JSON.stringify({ topic: "stream", body: { event: 2 } }) })
                            this._mockReply({ data: JSON.stringify({ topic: "stream", body: { event: 3 } }) })
                            setTimeout(function(){
                                sc.disconnect()
                            }, 50)
                        } else if (msg.topic == "control" && msg.body.action == "disconnect") {
                            disconnectCalled = true;
                        }
                    })

                    var dataSpy = jasmine.createSpyObj("spy", [ "start", "data", "end", "close" ]);

                    sc.on("start", dataSpy.start);
                    sc.on("data", dataSpy.data);
                    sc.on("end", dataSpy.end);
                    sc.on("close", dataSpy.close);

                    setTimeout(function(){
                        expect(dataSpy.start.calls.count()).toBe(1);
                        expect(dataSpy.end.calls.count()).toBe(1);
                        expect(dataSpy.close.calls.count()).toBe(1);
                        expect(dataSpy.data).toHaveBeenCalledWith({ event: 1 });
                        expect(dataSpy.data).toHaveBeenCalledWith({ event: 2 });
                        expect(dataSpy.data).toHaveBeenCalledWith({ event: 3 });
                        expect(disconnectCalled).toBeTruthy();
                        done()
                    }, 100);

                    connect();
                });

                it("stream.Readable.pipe(myPipe)", function(done){

                    var myPipe = jasmine.createSpyObj("myPipe", [ "write", "end" ]);

                    SockJSMock.prototype._mockOnSend(function(msg){
                        msg = JSON.parse(msg)
                        if (msg.topic == "control" && msg.body.action == "subscribe") {
                            sc.pipe(myPipe);
                            this._mockReply({ data: JSON.stringify({ topic: "control", body: { action: "subscribed" } }) })
                            this._mockReply({ data: JSON.stringify({ topic: "stream", body: { event: 1 } }) })
                            this._mockReply({ data: JSON.stringify({ topic: "stream", body: { event: 2 } }) })
                            this._mockReply({ data: JSON.stringify({ topic: "stream", body: { event: 3 } }) })
                            setTimeout(function(){
                                sc.disconnect()
                            }, 50)
                        }
                    })

                    setTimeout(function(){
                        expect(myPipe.write.calls.count()).toBe(3);
                        expect(myPipe.end.calls.count()).toBe(1);
                        done()
                    },100);

                    connect();

                });

                it("stream.Readable.unpipe(myPipe)", function(done){

                    var myPipe = jasmine.createSpyObj("myPipe", [ "write", "end" ]);
                    var myOtherPipe = jasmine.createSpyObj("myOtherPipe", [ "write", "end" ]);

                    SockJSMock.prototype._mockOnSend(function(msg){
                        msg = JSON.parse(msg)
                        if (msg.topic == "control" && msg.body.action == "subscribe") {
                            sc.pipe(myPipe);
                            sc.pipe(myOtherPipe);
                            this._mockReply({ data: JSON.stringify({ topic: "control", body: { action: "subscribed" } }) })
                            this._mockReply({ data: JSON.stringify({ topic: "stream", body: { event: 1 } }) })
                            this._mockReply({ data: JSON.stringify({ topic: "stream", body: { event: 2 } }) })
                            sc.unpipe(myPipe); // myOtherPipe should remain attached
                            this._mockReply({ data: JSON.stringify({ topic: "stream", body: { event: 3 } }) })
                            setTimeout(function(){
                                sc.disconnect()
                            }, 50)
                        }
                    })

                    setTimeout(function(){
                        expect(myPipe.write.calls.count()).toBe(2);
                        expect(myPipe.end.calls.count()).toBe(0);
                        expect(myOtherPipe.write.calls.count()).toBe(3);
                        expect(myOtherPipe.end.calls.count()).toBe(1);
                        done()
                    },100);

                    connect()
                });

                it("stream.Readable.unpipe()", function(done){

                    var myPipe = jasmine.createSpyObj("myPipe", [ "write", "end" ]);
                    var myOtherPipe = jasmine.createSpyObj("myOtherPipe", [ "write", "end" ]);

                    SockJSMock.prototype._mockOnSend(function(msg){
                        msg = JSON.parse(msg)
                        if (msg.topic == "control" && msg.body.action == "subscribe") {
                            sc.pipe(myPipe);
                            sc.pipe(myOtherPipe);
                            this._mockReply({ data: JSON.stringify({ topic: "control", body: { action: "subscribed" } }) })
                            this._mockReply({ data: JSON.stringify({ topic: "stream", body: { event: 1 } }) })
                            this._mockReply({ data: JSON.stringify({ topic: "stream", body: { event: 2 } }) })
                            sc.unpipe(); // detach all
                            this._mockReply({ data: JSON.stringify({ topic: "stream", body: { event: 3 } }) })
                            setTimeout(function(){
                                sc.disconnect()
                            }, 50)
                        }
                    })

                    setTimeout(function(){
                        expect(myPipe.write.calls.count()).toBe(2);
                        expect(myPipe.end.calls.count()).toBe(0);
                        expect(myOtherPipe.write.calls.count()).toBe(2);
                        expect(myOtherPipe.end.calls.count()).toBe(0);
                        done()
                    },100);

                    connect();
                });

            })

        })

    })

})
