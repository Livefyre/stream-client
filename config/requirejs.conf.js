require.config({
    paths: {
        'sockjs-client': 'node_modules/sockjs-client/sockjs',
        'events-event-emitter': 'node_modules/events-event-emitter/src/event-emitter',
        'util-extend': 'node_modules/util-extend/extend',
        sinon: 'node_modules/sinon/lib/sinon',
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
        'sockjs-client': {
            exports: 'SockJS'
        },
        sinon: {
          exports: 'sinon'
        }
    }
});
