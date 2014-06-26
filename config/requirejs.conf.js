require.config({
    paths: {
        'sockjs-client': 'lib/sockjs/sockjs',
        'events-event-emitter': 'node_modules/events-event-emitter/src/event-emitter',
        jquery: 'lib/jquery/dist/jquery',
        'util-extend': 'node_modules/util-extend/extend',
        sinon: 'lib/sinonjs/sinon',
        chai: 'node_modules/chai/chai',
        debug: 'lib/debug/debug'
    },
    packages: [{
        name: 'stream-client',
        location: 'src',
        main: 'StreamClient'
    },{
        name: 'jasmine',
        location: 'lib/jasmine/lib/jasmine-core',
        main: 'jasmine'
    }],
    shim: {
        jquery: {
            exports: '$'
        },
        'sockjs-client': {
            exports: 'SockJS'
        },
        sinon: {
          exports: 'sinon'
        }
    }
});
