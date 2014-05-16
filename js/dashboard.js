"use strict"

define(['StreamClient', 'angular'], function(StreamClient, angular){

    angular
        .module('app',[])
        .controller('Controller', ['$scope',
            function Controller($scope) {

                var options = {
                    streamUrl: window.location.protocol + "//" + window.location.hostname + ':' + window.location.port + '/stream',
                    chronosUrl: window.location.protocol + "//" + window.location.hostname + ':' + window.location.port + '/chronos'
                }

                $scope.connected = false;

                var sc = new StreamClient(options);
                sc.on("start", function(msg){
                    $scope.connected = true;
                })
                sc.on("data", function(msg){
                    console.log("Data received:", msg);
                })
                sc.on("close", function(){
                    $scope.connected = false;
                })

                var eventHandler = function eventHandler(event) {
                   console.log("Received event:", event);
                }

                $scope.connect = function() {
                    sc.connect({}, "user1234@cnn.fyre.co", eventHandler)
                }

                $scope.disconnect = function(){
                    sc.disconnect()
                }
            }
    ]);

    angular.bootstrap(document, ['app']);
});