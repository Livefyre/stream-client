"use strict"

define(['StreamClient', 'angular'], function(StreamClient, angular){

    angular
        .module('app',[])
        .controller('Controller', ['$scope','$window',
            function Controller($scope, $window) {

                var options = {
                    streamUrl: window.location.protocol + "//" + window.location.hostname + ':' + window.location.port + '/stream',
                    chronosUrl: window.location.protocol + "//" + window.location.hostname + ':' + window.location.port + '/chronos'
                }

                $scope.connected = false;
                $scope.activities = [];
                //$scope.lfToken = "eyJhbGciOiJIUzI1NiJ9.eyJkb21haW4iOiJjbm4uZnlyZS5jbyIsInVzZXJfaWQiOiI3MCIsImRpc3BsYXlfbmFtZSI6IiIsImV4cGlyZXMiOjI4NzIxMDczMzR9.BZr2LNa8H0TTB8DgZDr5HTVkaaPBn-f3B1P3mZHOY18";
                $scope.domain="cnn.fyre.co"
                $scope.userId="42"
                $scope.streamId = "urn:livefyre:cnn.fyre.co:topic=7";

                function makeToken() {
                    var json = {
                        domain: $scope.domain,
                        user_id: $scope.userId,
                        expires: (new Date().getTime() / 1000) + 3600 // token expires in 60 minutes
                    }
                    return "eyJhbGciOiJIUzI1NiJ9."+btoa(JSON.stringify(json))+".BZr2LNa8H0TTB8DgZDr5HTVkaaPBn-f3B1P3mZHOY18";
                }

                var sc = new StreamClient(options);
                sc.on("start", function(msg){
                    $scope.$apply(function(){
                        $scope.connected = true;
                        $scope.sessionId = sc.sessionId;
                        $scope.streamUrl = sc.options.streamUrl;
                    })
                })
                sc.on("data", function(msg){
                    $scope.$apply(function(){
                        $scope.activities.push(msg);
                        if ($scope.activities.length > 50) {
                            $scope.activities.splice(0, $scope.activities.length - 50)
                        }
                    })
                })
                sc.on("end", function(){
                    $scope.$apply(function(){
                        $scope.connected = false;
                        $scope.sessionId = null;
                        $scope.streamUrl = null;
                    })
                })
                sc.on("error", function(error){
                    $scope.$apply(function(){
                        console.error("Error in SC:", error.message)
                    })
                })

                $scope.connect = function() {
                    sc.connect(makeToken(), $scope.streamId)
                }

                $scope.disconnect = function(){
                    sc.disconnect()
                }

                $scope.die = function(){
                    sc.conn.close();
                }

                $scope.clear = function(){
                    $scope.activities = []
                }

                $scope.sample = function(){
                    $scope.streamId = "sample"
                    if ($scope.connected) {
                        sc.once("end", function(){
                            $scope.connect();
                        });
                        $scope.disconnect();
                    } else {
                        $scope.connect();
                    }

                }

                $scope.sessions = function() {
                    $window.open("/sessions")
                }
                $scope.sessionCounters = function() {
                    $window.open("/sessions/counters")
                }
            }
    ]);

    angular.bootstrap(document, ['app']);
});