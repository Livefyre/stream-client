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
                $scope.activities = [];

                var sc = new StreamClient(options);
                sc.on("start", function(msg){
                    $scope.$apply(function(){
                        $scope.connected = true;
                    })
                })
                sc.on("data", function(msg){
                    $scope.$apply(function(){
                        $scope.activities.push(msg);
                    })
                })
                sc.on("close", function(){
                    $scope.$apply(function(){
                        $scope.connected = false;
                    })
                })

                $scope.connect = function() {
                    sc.connect("eyJhbGciOiJIUzI1NiJ9.eyJkb21haW4iOiJjbm4uZnlyZS5jbyIsInVzZXJfaWQiOiI3MCIsImRpc3BsYXlfbmFtZSI6IiIsImV4cGlyZXMiOjI4NzIxMDczMzR9.BZr2LNa8H0TTB8DgZDr5HTVkaaPBn-f3B1P3mZHOY18",
                        "urn:livefyre:cnn.fyre.co:topic=7")
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
            }
    ]);

    angular.bootstrap(document, ['app']);
});