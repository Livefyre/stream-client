"use strict";

(function () {

//    var port = window.location.hostname == "localhost" ? 8080 : window.location.port;
//
//    var eb = window.EventBus = new vertx.EventBus(window.location.protocol + '//'
//        + window.location.hostname + ':' + port + '/eventbus');
//
//	eb.onclose = function() {
//       eb = null;
//       window.alert("Connection with EventBus lost (container died or restarted?)");
//	};
//
//	eb.onopen = function() {
//        console.log("Connected");
//        eb.send("ping-address", "Hellow from JS", function (msg) {
//            console.log("reply from srv:", msg);
//        })
//	};


})();


(function(SockJS){

    var port = window.location.hostname == "localhost" ? 8080 : window.location.port;
    var url = window.location.protocol + "//" + window.location.hostname + ':' + port + '/stream';

    function makeUUID(){return"xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx"
        .replace(/[xy]/g,function(a,b){return b=Math.random()*16,(a=="y"?b&3|8:b|0).toString(16)})}

    console.log("Attempting SockJS connection to: ", url);

    var sock = new SockJS(url, undefined, { debug: true });

    sock.onopen = function(e){
        console.log("onOpen", e)
        sock.send("Hey Boys!")
    }
    sock.onclose = function(e){
        console.log("onClose", e)
    }
    sock.onmessage = function(e){
        console.log("onMessage", e)
    }




})(SockJS);


