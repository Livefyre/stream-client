/**
 * Test stream-client
 */

/**
 * Override the definition of SockJS to be this mock of it.
 * We don't actually want to hit the network here.
 */
define('sockjs-client', ['test/mocks/sockjs-mock'], function (SockJSMock) {
    return SockJSMock;
});

// The actual tests
// Note that there are two defines in this module because
// I don't think you can do this with cajon-style cjs
define(function(require, exports, module){

"use strict";

var SockJSMock = require('test/mocks/sockjs-mock');
var StreamClient = require('stream-client');

describe('StreamClient', function(){

    var opts = {
        debug: true,
        hostname: 'unit.test',
        port: 80,
        retry: 3, // Reduced number for tests
        retryTimeout: 0 // For testing disable exponentially increasing long timeouts
    };
    var lfToken = "someBase64EncodedToken";
    var streamId = "urn:livefyre:cnn.fyre.co:user=user4996";

    describe('should', function(){

        it("be a function", function(){
            expect(typeof StreamClient).to.equal("function");
        });

        it("start in disconnected state", function(){
            var sc = new StreamClient(opts);
            expect(sc.state.value).to.equal(sc.States.DISCONNECTED);
        });

        it("try to connect via SockJS on connect", function(){
            var sc = new StreamClient(opts);
            expect(sc.state.value).to.equal(sc.States.DISCONNECTED);
            sc.connect(lfToken, streamId);
            expect(sc.state.value).to.equal(sc.States.CONNECTING);
            expect(sc.conn).not.to.be.undefined;
        })

        it("expect a LFToken and streamId on connect", function(){
            var sc = new StreamClient(opts);
            expect(function(){ sc.connect()                 }).to.throw()
            expect(function(){ sc.connect(lfToken)          }).to.throw()
            expect(function(){ sc.connect(null, streamId)   }).to.throw()
            expect(function(){ sc.connect(null, null)       }).to.throw()
        })

        it("connect only when disconnected", function(done) {
            var sc = new StreamClient(opts);
            sc.connect(lfToken, streamId)
            setTimeout(function(){
                expect(function(){ sc.connect(lfToken, streamId) }).to.throw()
                done()
            },0)
        })

        it("disconnect only when connected", function(){
            var sc = new StreamClient(opts);
            expect(sc.state.value).to.equal(sc.States.DISCONNECTED);
            expect(function(){ sc.disconnect() }).to.throw();
        });
    })

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

        var sc;
        var connect;
        beforeEach(function(){
            SockJSMock.prototype._mockReset();
            sc = new StreamClient(opts);
            connect = function() { sc.connect(lfToken, streamId); }
        })

        it("send a subscribe action to stream", function(done){

            SockJSMock.prototype._mockOnSend(function(msg){
                expect(msg).to.equal(JSON.stringify({
                    topic:"control",
                    body: {
                        action: "subscribe",
                        hostname: "unit.test",
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
                console.log('_mockOnSend');
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
                expect(message.message).to.equal("User unknown");
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
                expect(message.message).to.equal("User not authorized or stream unknown");
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
                                hostname: "rebalance.unit.test" }
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
                expect(urls.length).to.equal(2);
                expect(urls[0]).to.equal("http://unit.test/stream");
                expect(urls[1]).to.equal("http://rebalance.unit.test/stream");
                expect(sc.state.value).to.equal(sc.States.STREAMING); // now in streaming state
                done();
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

            var noop = function () {};
            var spyListener = sinon.stub({
                end: noop,
                close: noop,
                error: noop
            });

            sc.on("end", spyListener.end);
            sc.on("close", spyListener.close);
            sc.on("error", spyListener.error);

            // cause trouble
            sc.on("start", function(){
                sc.options.hostname = "non.existent.domain.com"
                sc.conn.close();
            });

            // I had to bump this tmeout to 500 to make tests pass on phantom
            setTimeout(function(){
                expect(sc.state.value).to.equal(sc.States.DISCONNECTED);
                expect(attempts).to.equal(4); // 1 connect + 3 failed connects
                expect(spyListener.end.callCount).to.equal(1);
                expect(spyListener.close.callCount).to.equal(1);
                expect(spyListener.error.callCount).to.equal(1);
                done();
            }, 500);

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
                        this.close();
                    }
                })

                var noop = function () {};
                var dataSpy = sinon.stub({
                    start: noop,
                    data: noop,
                    end: noop,
                    close: noop
                });

                sc.on("start", dataSpy.start);
                sc.on("data", dataSpy.data);
                sc.on("end", dataSpy.end);
                sc.on("close", dataSpy.close);

                setTimeout(function(){
                    expect(dataSpy.start.callCount).to.equal(1);
                    expect(dataSpy.end.callCount).to.equal(1);
                    expect(dataSpy.close.callCount).to.equal(1);
                    expect(dataSpy.data.calledWith({ event: 1 })).to.be.ok;
                    expect(dataSpy.data.calledWith({ event: 2 })).to.be.ok;
                    expect(dataSpy.data.calledWith({ event: 3 })).to.be.ok;
                    expect(disconnectCalled).to.be.ok;
                    done()
                }, 100);

                connect();
            });

            it("stream.Readable.pipe(myPipe)", function(done){


                var noop = function () {};
                var myPipe = sinon.stub({
                    write: noop,
                    end: noop
                });

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
                    } else if (msg.topic == "control" && msg.body.action == "disconnect") {
                        this.close();
                    }
                })

                setTimeout(function(){
                    expect(myPipe.write.callCount).to.equal(3);
                    expect(myPipe.end.callCount).to.equal(1);
                    done()
                },100);

                connect();

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
                    } else if (msg.topic == "control" && msg.body.action == "disconnect") {
                        this.close();
                    }
                })

                setTimeout(function(){
                    expect(myPipe.write.callCount).to.equal(2);
                    expect(myPipe.end.callCount).to.equal(0);
                    expect(myOtherPipe.write.callCount).to.equal(3);
                    expect(myOtherPipe.end.callCount).to.equal(1);
                    done()
                },100);

                connect()
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
                    } else if (msg.topic == "control" && msg.body.action == "disconnect") {
                        this.close();
                    }
                })

                setTimeout(function(){
                    expect(myPipe.write.callCount).to.equal(2);
                    expect(myPipe.end.callCount).to.equal(0);
                    expect(myOtherPipe.write.callCount).to.equal(2);
                    expect(myOtherPipe.end.callCount).to.equal(0);
                    done()
                },100);

                connect();
            });

        })

    })

})

});
