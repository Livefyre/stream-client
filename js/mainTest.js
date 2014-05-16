'use strict';

// Configure RequireJS to shim Jasmine
require.config({
    baseUrl: 'js',
    paths: {
//        SockJS: '//cdnjs.cloudflare.com/ajax/libs/sockjs-client/0.3.4/sockjs.min',
        'event-emitter': '//raw.githubusercontent.com/Livefyre/event-emitter/master/src/event-emitter',
        jquery: '//cdnjs.cloudflare.com/ajax/libs/jquery/2.1.1/jquery.min',
        'jasmine': '//cdnjs.cloudflare.com/ajax/libs/jasmine/2.0.0/jasmine',
        'jasmine-html': '//cdnjs.cloudflare.com/ajax/libs/jasmine/2.0.0/jasmine-html',
        'boot': '//cdnjs.cloudflare.com/ajax/libs/jasmine/2.0.0/boot'
    },
    shim: {
//        SockJS: {
//            exports: 'SockJS'
//        },
        jquery: {
            exports: '$'
        },
        'jasmine': {
            exports: 'jasmineRequire'
        },
        'jasmine-html': {
            deps: ['jasmine'],
            exports: 'jasmineRequire'
        },
        'boot': {
            deps: ['jasmine', 'jasmine-html'],
            exports: 'jasmineRequire'
        }
    }
});

define('$extend', ['jquery'], function($){
    return $.extend;
})

define('SockJS', ['jasmine', '$extend'], function(jasmine, $extend){
    jasmineRequire.base(jasmine)
    var SockJS = { send: function(){}, close: function(){} }
    return function newSockJS() {
        setTimeout(function(){
            if (SockJS.onopen) {
                SockJS.onopen();
            }
        }, 0) ;
        return SockJS;
    }
})

// Define all of your specs here. These are RequireJS modules.
var specs = [
    'StreamClientTest'
];

// Load Jasmine - This will still create all of the normal Jasmine browser globals unless `boot.js` is re-written to use the
// AMD or UMD specs. `boot.js` will do a bunch of configuration and attach it's initializers to `window.onload()`. Because
// we are using RequireJS `window.onload()` has already been triggered so we have to manually call it again. This will
// initialize the HTML Reporter and execute the environment.
require(['boot'], function () {

    // Load the specs
    require(specs, function () {

        // Initialize the HTML Reporter and execute the environment (setup by `boot.js`)
        window.onload();
    });
});
