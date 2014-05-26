require.config({
    baseUrl: '/js',
    paths: {
        angular: '//ajax.googleapis.com/ajax/libs/angularjs/1.3.0-beta.8/angular.min',
        SockJS: '//cdnjs.cloudflare.com/ajax/libs/sockjs-client/0.3.4/sockjs.min',
        'event-emitter': '//rawgit.com/Livefyre/event-emitter/master/src/event-emitter',
        jquery: '//cdnjs.cloudflare.com/ajax/libs/jquery/2.1.1/jquery.min'
    },
    shim: {
        jquery: {
            exports: '$'
        },
        angular: {
            exports: 'angular'
        },
        SockJS: {
            exports: 'SockJS'
        }
    },
});
define('$extend', ['jquery'], function($){
    return $.extend;
})
define(['dashboard'])