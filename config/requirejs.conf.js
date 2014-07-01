require.config({
    paths: {
        'sockjs-client': 'node_modules/sockjs-client/sockjs',
        'events-event-emitter': 'node_modules/events-event-emitter/src/event-emitter',
        'util-extend': 'node_modules/util-extend/extend',
    },
    packages: [{
        name: 'stream-client',
        location: 'src',
        main: 'StreamClient'
    }],
    shim: {
        'sockjs-client': {
            exports: 'SockJS'
        },
    }
});
