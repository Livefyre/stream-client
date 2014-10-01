/**
 * Test stream-client
 */

/**
 * Override the definition of SockJS to be this mock of it.
 * We don't actually want to hit the network here.
 */
define('sockjs-client', function () {
    return null;
});

// The actual tests
// Note that there are two defines in this module because
// I don't think you can do this with cajon-style cjs
define(function(require, exports, module){

"use strict";

var SockJSMockFactory = require('test/mocks/sockjs-mock');
var StreamClient = require('stream-client');

describe('StreamClient', function(){

    var opts;

    beforeEach(function(){
        opts = {
            SockJS: SockJSMockFactory(), // inject a SockJS mock
            debug: true,
            hostname: 'unit.test',
            port: 80,
            retry: 3, // Reduced number for tests
            retryTimeout: 0 // For testing disable exponentially increasing long timeouts
        };
    });

    var lfToken = "someBase64EncodedToken";
    var streamId = "urn:livefyre:cnn.fyre.co:user=user4996:personalStream";

    describe('should', function(){

        it("be a function", function(){
            expect(typeof StreamClient).to.equal("function");
        });

        it("start in disconnected state", function(){
            var sc = new StreamClient(opts);
            expect(sc.state.value).to.equal(sc.States.DISCONNECTED);
        });

        it("only try to connect via SockJS on subscription", function(){
            var sc = new StreamClient(opts);
            expect(sc.state.value).to.equal(sc.States.DISCONNECTED);
            sc.subscribe(streamId);
            expect(sc.state.value).to.equal(sc.States.CONNECTING);
            expect(sc.conn).not.to.be.undefined;
        });

        it("disconnect when no longer subscribed to any stream", function() {
            var mockOnSend = function (msg) {
                msg = JSON.parse(msg)
                if (msg.topic == "control" && msg.body.action == "subscribe") {
                    stream.close(); // unsubscribe
                    expect(sc.state.value).to.equal(sc.States.DISCONNECTING);
                }
            };
            opts.SockJS = SockJSMockFactory({ onSend: mockOnSend });
            var sc = new StreamClient(opts);
            expect(sc.state.value).to.equal(sc.States.DISCONNECTED);
            var stream = sc.subscribe(streamId); // subscribe to a single stream
        });

        it("use the provided auth token when subscribing", function() {
            var mockOnSend = function(msg){
                msg = JSON.parse(msg)
                if (msg.topic == "control" && msg.body.action == "subscribe") {
                    expect(msg.body.lfToken).to.equal(lfToken);
                }
            };
            opts.SockJS = SockJSMockFactory({ onSend: mockOnSend });
            var sc = new StreamClient(opts);
            sc.auth(lfToken);
            var stream = sc.subscribe(streamId); // subscribe to a single stream
        });

        it("reconnect when changing the auth token while streaming", function(done){
            var mockOnSend = function(msg){
                msg = JSON.parse(msg)
                if (msg.topic == "control" && msg.body.action == "subscribe") {
                    connectCount++;
                    this._mockReply({ data: JSON.stringify({
                        topic: "control",
                        body: {
                            streamId: streamId,
                            action: "subscribed"
                        }
                    })});
                }
            };
            opts.SockJS = SockJSMockFactory({ onSend: mockOnSend });
            var connectCount = 0;
            var sc = new StreamClient(opts);
            sc.auth(lfToken);
            var stream = sc.subscribe(streamId); // subscribe to a single stream
            stream.on('start', function(){
                if (connectCount == 1) {
                    sc.auth("");
                }
            });
            setTimeout(function(){
                expect(connectCount).to.equal(2);
                done();
            }, 70);
        });

        it("emit SubscriptionStream.Errors.REWIND_FAILED when requesting an out of bounds sequence but remain subscribed", function(done){
            var mockOnSend = function(msg){
                msg = JSON.parse(msg)
                if (msg.topic == "control" && msg.body.action == "subscribe" &&
                    msg.body.streams[0].resumeSeq == 22 && msg.body.streams[0].resumeTime == 33) {
                    this._mockReply({ data: JSON.stringify({
                        topic: "control",
                        body: {
                            streamId: streamId,
                            action: "subscribed"
                        }
                    })});
                    this._mockReply({ data: JSON.stringify({
                        topic: "control",
                        body: {
                            action: "rewindFailed",
                            streamId: streamId
                        }
                    })});
                }
            };
            opts.SockJS = SockJSMockFactory({ onSend: mockOnSend });
            var sc = new StreamClient(opts);
            sc.auth(lfToken);
            var stream = sc.subscribe(streamId, 22, 33); // subscribe to a stream with some invalid sequence
            stream.on('error', function(error){
                expect(error.type).to.equal(stream.Errors.REWIND_FAILED);
                done();
            });
        });

        it("emit SubscriptionStream.Errors.AUTH_FAILED when requesting a stream without proper authorization and end the stream", function(done){
            var mockOnSend = function(msg){
                msg = JSON.parse(msg)
                if (msg.topic == "control" && msg.body.action == "subscribe" &&
                    msg.body.lfToken == lfToken) {
                    this._mockReply({ data: JSON.stringify({
                        topic: "control",
                        body: {
                            action: "authFailed",
                            streamId: streamId
                        }
                    })});
                    this.close()
                }
            };
            opts.SockJS = SockJSMockFactory({ onSend: mockOnSend });
            var sc = new StreamClient(opts);
            sc.auth(lfToken);
            var stream = sc.subscribe(streamId);
            var errThrown;
            var endCalled;
            stream.on('error', function(error){
                errThrown = error;
            });
            stream.on('end', function(){
                endCalled = true;
            });
            setTimeout(function(){
                expect(errThrown).to.be.defined;
                expect(errThrown.type).to.equal(stream.Errors.AUTH_FAILED);
                expect(endCalled).to.be.truthy;
                done();
            }, 30);
        });

    });

    describe('constructing with opts.environment', function () {
        it('qa', function () {
            var sc = new StreamClient({ environment: 'qa' });
            expect(sc.options.hostname).to.equal('stream.qa-ext.livefyre.com');
        });
        it('uat', function () {
            var sc = new StreamClient({ environment: 'uat' });
            expect(sc.options.hostname).to.equal('stream.t402.livefyre.com');
        });
        it('production', function () {
            var sc = new StreamClient({ environment: 'production' });
            expect(sc.options.hostname).to.equal('stream.livefyre.com');
        });
        it('opts.hostname takes precedence', function () {
            var hostname = 'localhost';
            var sc = new StreamClient({
                environment: 'production',
                hostname: hostname
            });
            expect(sc.options.hostname).to.equal(hostname);
        })
    });

    describe("when connected should", function(){

        it("send a subscribe action to stream", function(done){
            var mockOnSend = function(msg){
                console.log(msg)
                expect(msg).to.equal(JSON.stringify({
                    protocol: "V1",
                    topic: "control",
                    body: {
                        action: "subscribe",
                        hostname: "unit.test",
                        lfToken: lfToken,
                        streams: [
                            { streamId: streamId, resumeTime: null, resumeSeq: null }
                        ]
                    }
                }));
                done();
            };
            opts.SockJS = SockJSMockFactory({ onSend: mockOnSend });
            var sc = new StreamClient(opts);
            sc.auth(lfToken);
            sc.subscribe(streamId);
        });

        it("handle rebalance command", function(done){

            var urls = [];

            var mockOnNew = function (url) {
                urls.push(url);
            };

            var mockOnSend = function (msg) {
                msg = JSON.parse(msg);
                if (msg.topic == "control" && msg.body.action == "subscribe") {
                    var serverResponse;
                    if (urls.length == 1) {
                        serverResponse = JSON.stringify({
                            topic: "control",
                            body: {
                                action: "rebalance",
                                hostname: "rebalance.unit.test" }
                        });
                        this._mockReply({ data: serverResponse });
                        this.close();
                    } else {
                        serverResponse = JSON.stringify({
                            topic: "control",
                            body: {
                                action: "subscribed",
                                streamId: streamId
                            }
                        });
                        this._mockReply({ data: serverResponse });
                    }
                }
            };

            opts.SockJS = SockJSMockFactory({ onSend: mockOnSend, onNew: mockOnNew });
            var sc = new StreamClient(opts);
            sc.auth(lfToken);
            var stream = sc.subscribe(streamId);

            stream.on("start", function () {
                expect(urls.length).to.equal(2);
                expect(urls[0]).to.equal("http://unit.test/stream");
                expect(urls[1]).to.equal("http://rebalance.unit.test/stream");
                expect(sc.state.value).to.equal(sc.States.STREAMING); // now in streaming state
                done();
            });

        });

        it("reconnect 3 times when the connection dies, before sending 'end' and 'close' events", function(done){

            var attempts = 0;
            var mockOnNew = function(){
                attempts++;
            };

            var mockOnSend = function(msg){
                msg = JSON.parse(msg)
                if (msg.topic == "control" && msg.body.action == "subscribe") {
                    var serverResponse = JSON.stringify({
                        topic: "control",
                        body: { action: "subscribed", streamId: streamId }
                    });
                    this._mockReply({ data: serverResponse });
                }
            };

            var noop = function () {};
            var spyListener = sinon.stub({
                end: noop,
                close: noop,
                globalerror: noop,
                error: noop
            });

            opts.SockJS = SockJSMockFactory({ onSend: mockOnSend, onNew: mockOnNew });
            var sc = new StreamClient(opts);
            var stream = sc.subscribe(streamId);

            sc.on("error", spyListener.globalerror);
            stream.on("end", spyListener.end);
            stream.on("close", spyListener.close);
            stream.on("error", spyListener.error);

            // cause trouble
            stream.on("start", function(){
                sc.options.hostname = "non.existent.domain.com"
                sc.conn.close();
            });

            // I had to bump this tmeout to 500 to make tests pass on phantom
            setTimeout(function(){
                expect(sc.state.value).to.equal(sc.States.DISCONNECTED);
                expect(attempts).to.equal(4); // 1 connect + 3 failed connects
                expect(spyListener.end.callCount).to.equal(1, "stream.end");
                expect(spyListener.error.callCount).to.equal(1, "stream.error");
                expect(spyListener.close.callCount).to.equal(1, "stream.close");
                expect(spyListener.globalerror.callCount).to.equal(1, "sc.error");
                done();
            }, 500);
        });

        describe("support node stream.Readable API", function(){

            it("events: 'start', 'data', 'end', 'close', 'error'", function(done){

                var disconnectCalled = false;
                var mockOnSend = function(msg){
                    msg = JSON.parse(msg);
                    if (msg.topic == "control" && msg.body.action == "subscribe") {
                        this._mockReply({ data: JSON.stringify({ topic: "control", body: { action: "subscribed", streamId: streamId } }) })
                        this._mockReply({ data: JSON.stringify({ topic: "stream", streamId: streamId, sequence: 1, eventId: 10, body: { event: 1 } }) })
                        this._mockReply({ data: JSON.stringify({ topic: "stream", streamId: streamId, sequence: 2, eventId: 20, body: { event: 2 } }) })
                        this._mockReply({ data: JSON.stringify({ topic: "stream", streamId: streamId, sequence: 3, eventId: 30, body: { event: 3 } }) })
                        setTimeout(function(){
                            sc.disconnect()
                        }, 50)
                    } else if (msg.topic == "control" && msg.body.action == "disconnect") {
                        disconnectCalled = true;
                        this.close();
                    }
                };

                var noop = function () {};
                var dataSpy = sinon.stub({
                    start: noop,
                    data: noop,
                    end: noop,
                    close: noop,
                    error: noop
                });

                opts.SockJS = SockJSMockFactory({ onSend: mockOnSend });
                var sc = new StreamClient(opts);
                var stream = sc.subscribe(streamId);

                stream.on("start", dataSpy.start);
                stream.on("data", dataSpy.data);
                stream.on("end", dataSpy.end);
                stream.on("close", dataSpy.close);
                stream.on("error", dataSpy.error);

                setTimeout(function(){
                    expect(dataSpy.start.callCount).to.equal(1);
                    expect(dataSpy.end.callCount).to.equal(1);
                    expect(dataSpy.close.callCount).to.equal(1);
                    expect(dataSpy.error.callCount).to.equal(0);
                    expect(dataSpy.data.calledWith({ eventId: 10, eventSequence: 1, event: { event: 1 }})).to.be.ok;
                    expect(dataSpy.data.calledWith({ eventId: 20, eventSequence: 2, event: { event: 2 }})).to.be.ok;
                    expect(dataSpy.data.calledWith({ eventId: 30, eventSequence: 3, event: { event: 3 }})).to.be.ok;
                    expect(disconnectCalled).to.be.ok;
                    done()
                }, 200);
            });

            it("stream.Readable.pipe(myPipe)", function(done){


                var noop = function () {};
                var myPipe = sinon.stub({
                    write: noop,
                    end: noop
                });

                var mockOnSend = function(msg){
                    msg = JSON.parse(msg)
                    if (msg.topic == "control" && msg.body.action == "subscribe") {
                        stream.pipe(myPipe);
                        this._mockReply({ data: JSON.stringify({ topic: "control", body: { action: "subscribed", streamId: streamId } }) })
                        this._mockReply({ data: JSON.stringify({ topic: "stream", streamId: streamId, sequence: 1, eventId: 10, body: { event: 1 } }) })
                        this._mockReply({ data: JSON.stringify({ topic: "stream", streamId: streamId, sequence: 2, eventId: 20, body: { event: 2 } }) })
                        this._mockReply({ data: JSON.stringify({ topic: "stream", streamId: streamId, sequence: 3, eventId: 30, body: { event: 3 } }) })
                        setTimeout(function(){
                            sc.disconnect()
                        }, 50)
                    } else if (msg.topic == "control" && msg.body.action == "disconnect") {
                        this.close();
                    }
                };

                opts.SockJS = SockJSMockFactory({ onSend: mockOnSend });
                var sc = new StreamClient(opts);
                var stream = sc.subscribe(streamId);

                setTimeout(function(){
                    expect(myPipe.write.callCount).to.equal(3);
                    expect(myPipe.end.callCount).to.equal(1);
                    done()
                },100);

            });

            it("stream.Readable.unpipe(myPipe)", function(done){

                var noop = function () {};
                var myPipe = sinon.stub({
                    write: noop,
                    end: noop
                });
                var myOtherPipe = sinon.stub({
                    write: noop,
                    end: noop
                });

                var mockOnSend = function(msg){
                    msg = JSON.parse(msg);
                    if (msg.topic == "control" && msg.body.action == "subscribe") {
                        stream.pipe(myPipe);
                        stream.pipe(myOtherPipe);
                        this._mockReply({ data: JSON.stringify({ topic: "control", body: { action: "subscribed", streamId: streamId } }) })
                        this._mockReply({ data: JSON.stringify({ topic: "stream", streamId: streamId, sequence: 1, eventId: 10, body: { event: 1 } }) })
                        this._mockReply({ data: JSON.stringify({ topic: "stream", streamId: streamId, sequence: 2, eventId: 20, body: { event: 2 } }) })
                        stream.unpipe(myPipe); // myOtherPipe should remain attached
                        this._mockReply({ data: JSON.stringify({ topic: "stream", streamId: streamId, sequence: 3, eventId: 30, body: { event: 3 } }) })
                        setTimeout(function(){
                            sc.disconnect()
                        }, 50)
                    } else if (msg.topic == "control" && msg.body.action == "disconnect") {
                        this.close();
                    }
                };

                opts.SockJS = SockJSMockFactory({ onSend: mockOnSend });
                var sc = new StreamClient(opts);
                var stream = sc.subscribe(streamId);

                setTimeout(function(){
                    expect(myPipe.write.callCount).to.equal(2);
                    expect(myPipe.end.callCount).to.equal(0);
                    expect(myOtherPipe.write.callCount).to.equal(3);
                    expect(myOtherPipe.end.callCount).to.equal(1);
                    done()
                },100);
            });

            it("stream.Readable.unpipe()", function(done){

                var noop = function () {};
                var myPipe = sinon.stub({
                    write: noop,
                    end: noop
                });
                var myOtherPipe = sinon.stub({
                    write: noop,
                    end: noop
                });

                var mockOnSend = function(msg){
                    msg = JSON.parse(msg)
                    if (msg.topic == "control" && msg.body.action == "subscribe") {
                        stream.pipe(myPipe);
                        stream.pipe(myOtherPipe);
                        this._mockReply({ data: JSON.stringify({ topic: "control", body: { action: "subscribed", streamId: streamId } }) })
                        this._mockReply({ data: JSON.stringify({ topic: "stream", streamId: streamId, sequence: 1, eventId: 10, body: { event: 1 } }) })
                        this._mockReply({ data: JSON.stringify({ topic: "stream", streamId: streamId, sequence: 2, eventId: 20, body: { event: 2 } }) })
                        stream.unpipe(); // detach all
                        this._mockReply({ data: JSON.stringify({ topic: "stream", streamId: streamId, sequence: 3, eventId: 30, body: { event: 3 } }) })
                        setTimeout(function(){
                            sc.disconnect()
                        }, 50)
                    } else if (msg.topic == "control" && msg.body.action == "disconnect") {
                        this.close();
                    }
                };

                opts.SockJS = SockJSMockFactory({ onSend: mockOnSend });
                var sc = new StreamClient(opts);
                var stream = sc.subscribe(streamId);

                setTimeout(function(){
                    expect(myPipe.write.callCount).to.equal(2);
                    expect(myPipe.end.callCount).to.equal(0);
                    expect(myOtherPipe.write.callCount).to.equal(2);
                    expect(myOtherPipe.end.callCount).to.equal(0);
                    done()
                },100);
            });

            it("stream.Readable.pause() and .resume()", function(done){

                var noop = function () {};
                var myPipe = sinon.stub({
                    write: noop,
                    end: noop
                });

                var mockOnSend = function(msg){
                    msg = JSON.parse(msg)
                    if (msg.topic == "control" && msg.body.action == "subscribe") {
                        this._mockReply({ data: JSON.stringify({ topic: "control", body: { action: "subscribed", streamId: streamId } }) })
                        this._mockReply({ data: JSON.stringify({ topic: "stream", streamId: streamId, sequence: 1, eventId: 10, body: { event: 1 } }) })
                        stream.pause();
                        this._mockReply({ data: JSON.stringify({ topic: "stream", streamId: streamId, sequence: 2, eventId: 20, body: { event: 2 } }) })
                        this._mockReply({ data: JSON.stringify({ topic: "stream", streamId: streamId, sequence: 3, eventId: 30, body: { event: 3 } }) })
                        setTimeout(function(){
                            sc.disconnect()
                        }, 50)
                    } else if (msg.topic == "control" && msg.body.action == "disconnect") {
                        this.close();
                    }
                };

                opts.SockJS = SockJSMockFactory({ onSend: mockOnSend });
                var sc = new StreamClient(opts);
                var stream = sc.subscribe(streamId);
                stream.pipe(myPipe);

                setTimeout(function(){
                    expect(myPipe.write.callCount).to.equal(1);
                    stream.resume();
                    setTimeout(function(){
                        expect(myPipe.write.callCount).to.equal(3);
                        done()
                    },50);
                },100);
            });

        })

    })

})

});
