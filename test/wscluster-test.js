/*
 * Copyright 2012 eBay Software Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *    http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

'use strict';

var spawn = require('child_process').spawn,
    request = require('request'),
    fs = require('fs'),
    os = require('os'),
    EventEmitter = require('events').EventEmitter,
    util = require('util'),
    _ = require('underscore'),
    Q = require('q'),
    WebSocketClient = require("websocket").client;

var debug = false;
function log() {
    if(debug) {
        console.log.apply(null, (arguments || []).join(''));
    }
}
var port = 3000,
    monPort = 10000 - port;

module.exports = {

    setUp: function (callback) {
        //to ensure that occupying ports won't cause all test cases to fail
        fs.exists("./ports", function(exists){
            if(!exists){
                fs.writeFileSync("./ports", port);
            }
            fs.readFile("./ports",
                function(err, data){
                    port = parseInt(data, 10) + 1;
                    if(port >= 5000){
                        port = 3000;
                    }
                    monPort = 10000 - port;
                    fs.writeFile("./ports", "" + port, {
                            encoding : "utf8"
                        },
                        function(){
                            callback();
                        });
                });
        });
    },

    'start and then stop': function(test) {
        var emitter = new EventEmitter(), child = start(emitter);

        emitter.on('starting', function() {
            waitForStart(child, emitter, test, 0, 100);
        });

        emitter.on('started', function () {
            //create 10 clients and verify that the websocket has been opened and served by different cluster workers.
            _.each(_.range(0, 10), function(e){
                var client = new WebSocketClient();
                client.on('connectFailed', function(error) {
                    console.log('Connect Error: ' + error.toString());
                });

                client.on('connect', function(connection) {
                    console.log('WebSocket client connected');
                    connection.on('error', function(error) {
                        console.log("Connection Error: " + error.toString());
                    });
                    connection.on('close', function() {
                        console.log('echo-protocol Connection Closed');
                    });
                    connection.on('message', function(message) {
                        if (message.type === 'utf8') {
                            console.log("Received: '" + message.utf8Data + "'");
                        }
                    });

                    var now = new Date().getTime();
                    function sendNumber() {
                        if (connection.connected) {
                            var number = Math.round(Math.random() * 0xFFFFFF);
                            connection.sendUTF(number.toString());
                        }
                        if(new Date().getTime() - now < 10000){
                            setTimeout(sendNumber, 1000);
                        }
                        else{
                            stop(emitter);
                        }
                    }
                    sendNumber();
                });

                client.connect('ws://localhost:' + port + '/', 'echo-protocol');
            });
        });

        emitter.on('start failure', function (error) {
            log('Failed to start ', error.stack || error);
            test.ok(false, 'failed to start')
        });

        emitter.on('stopping', function() {
            waitForStop.apply(null, [emitter, test, 0, 100])
        });

        emitter.on('stopped', function() {
            log('Stopped');
            // Assert that there are 0 pids.
            fs.readdir('./pids', function(err, paths) {
                test.equal(paths.length, 0);
            });
            test.done();
        });

        emitter.emit('starting');
    }
}

// Start the cluster
function start(emitter) {
    log('Starting');
    var env = {};
    _.extend(env, process.env);
    _.extend(env, {
        port:port,
        monPort:monPort
    });
    var start = spawn('node', ['test/lib/wsserver.js'], {
        env: env,
        stdio: ['pipe', 1, 2, 'ipc']//enable piped stdout, and ipc for messaging
    });
    start.on('exit', function (code, signal) {
        log('Process exited with signal ', signal, ' and code ', code);
    });

    return start;
}

function stop(emitter) {
    log('Stopping');
    var stop = spawn('node', ['test/lib/stop.js']);
    stop.on('exit', function (code, signal) {
        log('Process exited with signal ', signal, ' and code ', code);
    });

    stop.stdout.setEncoding('utf8');
    stop.stdout.on('data', function (data) {
        log(data);
    });
    emitter.emit('stopping');
}

function shutdown(emitter) {
    log('Shutting down');
    var shutdown = spawn('node', ['test/lib/shutdown.js']);
    shutdown.on('exit', function (code, signal) {
        log('Process exited with signal ', signal, ' and code ', code);
    });

    shutdown.stdout.setEncoding('utf8');
    shutdown.stdout.on('data', function (data) {
        log(data);
    });
    emitter.emit('stopping');
}

/*
 function waitForStart(child, emitter, test, current, max) {
 current++;
 if(current < max) {
 request(util.format('http://localhost:%d', port), function (error, response, body) {
 log('Waiting for server to start');
 if(error) {
 log('Error: ', error.stack || error);
 if(error.code === 'ECONNREFUSED') {
 setTimeout(function () {
 waitForStart.apply(null, [child, emitter, test, current, max])
 }, 100);
 }
 }
 else {
 emitter.emit('started');
 }
 });
 }
 else {
 test.ok(false, 'Server did not start. Giving up');
 test.done();
 }
 }
 */

function waitForStart(child, emitter, test) {

    var deferred = Q.defer();
    var timeOut = setTimeout(function(){
        deferred.reject(new Error("timeout"));
    }, 3000);

    child.on("message", function(message){
        if(message.ready){
            clearTimeout(timeOut);
            deferred.resolve();
        }
        if(message.type === 'heartbeat'){
            emitter.emit('heartbeat', message);
        }
    });

    deferred.promise.then(function(){
        emitter.emit("started");
    })
        .fail(function(error){
            test.ok(false, error);
            test.done();
        });
}

function waitForStop(emitter, test, current, max) {
    current++;
    if(current < max) {
        request(util.format('http://localhost:%d', port), function (error, response, body) {
            log('Waiting for server to stop');
            if(error) {
                emitter.emit('stopped');
            }
            else {
                setTimeout(function () {
                    waitForStop.apply(null, [emitter, test, current, max])
                }, 100);
            }
        });
    }
    else {
        test.ok(false, 'Server did not start. Giving up');
        test.done();
    }
}


