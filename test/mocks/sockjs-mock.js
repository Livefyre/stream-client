'use strict';

var SockJSMockFactory = module.exports = function(opts) {
    opts = opts || {}
    function SockJSMock() {
        this._args = arguments;
        this.send = function () {
            if (opts.onSend) {
                opts.onSend.apply(this, arguments)
            }
        }.bind(this);
        this.close = function () {
            setTimeout(function () {
                if (this.onclose) { // SockJS API
                    this.onclose();
                }
            }.bind(this), 0);
            if (opts.onClose) {
                opts.onClose(this);
            }
        }.bind(this);
        setTimeout(function(){ // The connect logic
            if (this._args[0] == "http://non.existent.domain.com/stream") { // Simulate a failing connection
                this.close();
            } else if (this.onopen) { // SockJS API
                this.onopen();
            }
        }.bind(this), 0);
        if (opts.onNew) {
            opts.onNew.apply(this, this._args);
        }
    };

    var mockUtils = {
        probeProtocols: function () {
            return ['websocket',
                'xdr-streaming',
                'xhr-streaming',
                'iframe-eventsource',
                'iframe-htmlfile',
                'xdr-polling',
                'xhr-polling',
                'iframe-xhr-polling',
                'jsonp-polling'];
        }
    };

    SockJSMock.getUtils = function () {
        return mockUtils;
    };

    SockJSMock.prototype._mockReply = function (msg) {
        if (this.onmessage) {
            this.onmessage(msg);
        }
    };

    return SockJSMock;
};

