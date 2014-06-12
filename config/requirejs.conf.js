require.config({
    baseUrl: '/',
    paths: {
        SockJS: 'lib/sockjs/sockjs',
        'event-emitter': 'lib/event-emitter/src/event-emitter',
        jquery: 'lib/jquery/dist/jquery',
        extend: 'lib/util-extend/extend',
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
        SockJS: {
            exports: 'SockJS'
        },
        sinon: {
          exports: 'sinon'
        }
    }
});
