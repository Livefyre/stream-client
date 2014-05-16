"use strict";

// SockJS mock
define('SockJS', ['jasmine', '$extend'], function(jasmine, $extend){
    jasmineRequire.base(jasmine)
    return function newSockJS() {
        var obj = { send: function(){},
            close: function(){
                if (obj.onclose) {
                    obj.onclose();
                }
            }
        };
        obj._args = arguments;
        setTimeout(function(){
            if (obj._args[0] == "http://non.existent.domain.com/stream") {
                if (obj.onclose) {
                    obj.onclose();
                }
            } else if (obj.onopen) {
                obj.onopen();
            }
        }, 0) ;
        return obj;
    }
})

// StreamClient test specs
define(['StreamClient', 'SockJS'], function(StreamClient, SockJS){

    describe('StreamClient', function(){

        var opts = {
            streamUrl: 'http://unit.test/stream',
            chronosUrl: 'http://unit.test/chronos',
        }
        var lfToken = { jid: "user4996@cnn.fyre.co" };
        var streamId = "urn:livefyre:cnn.fyre.co:user=user4996";

        it("should be a function", function(){
            expect(typeof StreamClient).toEqual("function");
        });

        it("should start in disconnected state", function(){
            var sc = new StreamClient(opts)
            expect(sc.state.value).toBe(sc.States.DISCONNECTED)
        });

        it("should try to connect via SockJS on connect", function(){
            var sc = new StreamClient(opts);
            expect(sc.state.value).toBe(sc.States.DISCONNECTED);
            sc.connect(lfToken, streamId);
            expect(sc.state.value).toBe(sc.States.CONNECTING);
            expect(sc.conn).toBeDefined();
        })

        it("should expect a LFToken and streamId on connect", function(){
            var sc = new StreamClient(opts);
            expect(function(){ sc.connect()                 }).toThrow()
            expect(function(){ sc.connect(lfToken)          }).toThrow()
            expect(function(){ sc.connect(null, streamId)   }).toThrow()
            expect(function(){ sc.connect(null, null)       }).toThrow()
        })

        it("should connect only when disconnected", function(done) {
            var sc = new StreamClient(opts);
            sc.connect(lfToken, streamId)
            setTimeout(function(){
                expect(function(){ sc.connect(lfToken, streamId) }).toThrow()
                done()
            },0)
        })

        it("should disconnect only when connected", function(){
            var sc = new StreamClient(opts);
            expect(sc.state.value).toBe(sc.States.DISCONNECTED);
            expect(function(){ sc.disconnect() }).toThrow();
        });

        describe("when connected", function(){

            var sc;
            beforeEach(function(){
                sc = new StreamClient(opts);
                sc.state.on("change", function(oldVal, newVal){
                    console.debug("change", oldVal, ">>", newVal);
                })
                sc.connect(lfToken, streamId);
            })

            it("should send a subscribe action to stream", function(done){

                spyOn(sc.conn, "send").and.callThrough();

                setTimeout(function(){ // Call is async
                    expect(sc.conn.send).toHaveBeenCalledWith({
                        topic:"control",
                        body: {
                            action: "subscribe",
                            lfToken: lfToken,
                            streamId: streamId
                        }
                    });
                    done()
                },0);
            })

            it("should handle an auth failure on subscribe", function(done){

                // Mock server response
                sc.conn.send = function(msg){
                    if (msg.topic == "control" && msg.body.action == "subscribe") {
                        setTimeout(function(){
                            sc.conn.onmessage({
                                topic: "control",
                                body: { action: "error", error: "User unknown"}
                            })
                        },0)
                    }
                }
                sc.on("error", function(message){
                    expect(message).toEqual("User unknown");
                    done();
                })
            });

            it("should handle a failure on subscribe", function(done){

                // Mock server response
                sc.conn.send = function(msg){
                    if (msg.topic == "control" && msg.body.action == "subscribe") {
                        setTimeout(function(){
                            sc.conn.onmessage({
                                topic: "control",
                                body: { action: "error", error: "User not authorized or stream unknown"}
                            })
                        },0)
                    }
                }

                sc.on("error", function(message){
                    expect(message).toEqual("User not authorized or stream unknown");
                    done();
                })
            });

            it("should handle rebalance command", function(done){

                var oldConn = sc.conn;
                expect(sc.conn._args[0]).toBe(opts.streamUrl); // initially connected to unit test url

                // Mock server response
                sc.conn.send = function(msg){ // attach immediately, CONNECTING event already sent
                    if (msg.topic == "control" && msg.body.action == "subscribe") {
                        setTimeout(function(){
                            sc.conn.onmessage({
                                topic: "control",
                                body: {
                                    action: "rebalance",
                                    streamUrl: "http://rebalance.unit.test/stream" }
                            })
                        },0)
                    }
                }
                sc.state.on("change", function(oldValue, newValue){
                    if (newValue == sc.States.RECONNECTING) {
                        setTimeout(function(){ // 2nd connect is asynchronous, so new conn
                            sc.conn.send = function(msg){
                                if (msg.topic == "control" && msg.body.action == "subscribe") {
                                    setTimeout(function(){
                                        sc.conn.onmessage({
                                            topic: "control",
                                            body: { action: "subscribed" }
                                        })
                                    },0)
                                }
                            }
                        },0)
                    }
                    if (newValue == sc.States.STREAMING) {
                        expect(oldConn).not.toBe(sc.conn); // new connection opened?
                        expect(sc.conn._args[0]).toBe("http://rebalance.unit.test/stream"); // using rebalanced url?
                        expect(sc.state.value).toBe(sc.States.STREAMING); // now in streaming state
                        done()
                    }
                })
            });

            it("should reconnect 3 times when the connection dies, before sending 'end' and 'close' events", function(done){

                var attempts = 0;
                sc.state.on("change", function(oldVal, newVal){
                    if (newVal == sc.States.RECONNECTING) {
                        attempts++;
                    }
                })

                var spyListener = jasmine.createSpyObj("spyListener", [ "end", "close", "error"])
                sc.on("end", spyListener.end);
                sc.on("close", spyListener.close);
                sc.on("error", spyListener.error);

                // cause trouble, needs async call, conn open is async
                setTimeout(function(){
                    sc.options.streamUrl = "http://non.existent.domain.com/stream"
                    sc.conn.onclose(); // fake a network disconnect
                }, 0)

                setTimeout(function(){
                    expect(sc.state.value).toBe(sc.States.DISCONNECTED);
                    expect(attempts).toBe(3);
                    expect(spyListener.end.calls.count()).toEqual(1);
                    expect(spyListener.close.calls.count()).toEqual(1);
                    expect(spyListener.error.calls.count()).toEqual(1);
                    done();
                }, 1500); // long wait due to increasing reconnect delays

            })

            it("should fetch data from chronos and buffer stream data until chronos data comes in");

            describe("should support node stream.Readable API", function(){

                it("events: 'start', 'data', 'end', 'close'", function(){

                    setTimeout(function(){
                        sc.conn.onmessage({
                            topic: "control",
                            body: { action: "subscribed" }
                        })
                        sc.conn.onmessage({ topic: "stream", body: { event: 1 }})
                        sc.conn.onmessage({ topic: "stream", body: { event: 2 }})
                        sc.conn.onmessage({ topic: "stream", body: { event: 3 }})
                        setTimeout(function(){
                            sc.disconnect()
                        }, 50)
                    },0)

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
                        done()
                    },100);

                });

                it("stream.Readable.pipe(myPipe)", function(){

                    var myPipe = jasmine.createSpyObj("myPipe", [ "write" ]);

                    setTimeout(function(){
                        sc.pipe(myPipe);
                        sc.conn.onmessage({
                            topic: "control",
                            body: { action: "subscribed" }
                        })
                        sc.conn.onmessage({ topic: "stream", body: { event: 1 }})
                        sc.conn.onmessage({ topic: "stream", body: { event: 2 }})
                        sc.conn.onmessage({ topic: "stream", body: { event: 3 }})
                        setTimeout(function(){
                            sc.disconnect()
                        }, 50)
                    },0)

                    setTimeout(function(){
                        expect(myPipe.write.calls.count()).toBe(3);
                        expect(myPipe.end.calls.count()).toBe(1);
                        done()
                    },100);

                });

                it("stream.Readable.unpipe(myPipe)", function(){

                    var myPipe = jasmine.createSpyObj("myPipe", [ "write" ]);
                    var myOtherPipe = jasmine.createSpyObj("myOtherPipe", [ "write" ]);

                    setTimeout(function(){
                        sc.pipe(myPipe);
                        sc.pipe(myOtherPipe);
                        sc.conn.onmessage({
                            topic: "control",
                            body: { action: "subscribed" }
                        })
                        sc.conn.onmessage({ topic: "stream", body: { event: 1 }})
                        sc.conn.onmessage({ topic: "stream", body: { event: 2 }})
                        sc.unpipe(myPipe); // myOtherPipe should remain attached
                        sc.conn.onmessage({ topic: "stream", body: { event: 3 }})
                        setTimeout(function(){
                            sc.disconnect()
                        }, 50)
                    },0)


                    setTimeout(function(){
                        expect(myPipe.write.calls.count()).toBe(2);
                        expect(myOtherPipe.write.calls.count()).toBe(3);
                        expect(myPipe.end.calls.count()).toBe(0);
                        expect(myOtherPipe.end.calls.count()).toBe(1);
                        done()
                    },100);

                });

                it("stream.Readable.unpipe()", function(){

                    var myPipe = jasmine.createSpyObj("myPipe", [ "write" ]);
                    var myOtherPipe = jasmine.createSpyObj("myOtherPipe", [ "write" ]);

                    setTimeout(function(){
                        sc.pipe(myPipe);
                        sc.pipe(myOtherPipe);
                        sc.conn.onmessage({
                            topic: "control",
                            body: { action: "subscribed" }
                        })
                        sc.conn.onmessage({ topic: "stream", body: { event: 1 }})
                        sc.conn.onmessage({ topic: "stream", body: { event: 2 }})
                        sc.unpipe(); // detach all
                        sc.conn.onmessage({ topic: "stream", body: { event: 3 }})
                        setTimeout(function(){
                            sc.disconnect()
                        }, 50)
                    },0)


                    setTimeout(function(){
                        expect(myPipe.write.calls.count()).toBe(2);
                        expect(myOtherPipe.write.calls.count()).toBe(2);
                        expect(myPipe.end.calls.count()).toBe(0);
                        expect(myOtherPipe.end.calls.count()).toBe(0);
                        done()
                    },100);

                });

            })

        })

    })

})
