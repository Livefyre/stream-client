"use strict";

define(['StreamClient', 'SockJS'], function(StreamClient, SockJS){

    describe('StreamClient', function(){

        var opts = {
            streamUrl: 'http://unit.test/stream',
            chronosUrl: 'http://unit.test/chronos',
        }
        var lfToken = { jid: "user4996@cnn.fyre.co" };
        var streamId = "urn:livefyre:cnn.fyre.co:user=user4996";

        it("should be  a function", function(){
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

        it("should connect only when disconnected", function() {
            var sc = new StreamClient(opts);
            sc.connect(lfToken, streamId)
            expect(function(){ sc.connect(lfToken, streamId) }).toThrow()
        })

        it("should disconnect only when connected", function(){
            var sc = new StreamClient(opts);
            expect(sc.state.value).toBe(sc.States.DISCONNECTED);
            expect(function(){ sc.disconnect() }).toThrow();
        });

        it("should send a subscribe action to stream when connected", function(done){
            var sc = new StreamClient(opts);
            sc.state.on("change", function(oldVal, newVal){
                console.debug("change", oldVal, ">>", newVal);
            })
            sc.connect(lfToken, streamId);

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

        it("should handle an auth failure", function(done){
            var sc = new StreamClient(opts);
            sc.state.on("change", function(oldVal, newVal){
                console.debug("change", oldVal, ">>", newVal);
            })
            sc.connect(lfToken, streamId);

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

        it("should handle a subscription failure", function(done){
            var sc = new StreamClient(opts);
            sc.state.on("change", function(oldVal, newVal){
                console.debug("change", oldVal, ">>", newVal);
            })
            sc.connect(lfToken, streamId);

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
                expect(message).toEqual("User unknown");
                done();
            })
        });

        it("should handle rebalance command");


        it("should support node ReadStream.pipe");
        it("should support node ReadStream event 'data'");
        it("should support node ReadStream event 'end'");
        it("should support node ReadStream event 'close'");
        it("should support node ReadStream event 'error'");

    })

})
