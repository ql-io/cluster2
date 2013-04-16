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
    Q = require('q');

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
            stop(emitter);
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
    },

    'start, check heartbeat and stop': function(test) {
        var emitter = new EventEmitter(), child = start(emitter);

        emitter.on('starting', function() {
            waitForStart(child, emitter, test, 0, 100);
        });

        emitter.on('started', function () {

            var timeOut = setTimeout(function(){
                test.ok(false, "timeout and no heartbeat found");
                stop(emitter);
            }, 3000);

            emitter.on('heartbeat', function(heartbeat){
                test.ok(heartbeat.pid);
                test.ok(heartbeat.uptime);
                test.ok(heartbeat.totalmem);
                test.ok(heartbeat.freemem);

                clearTimeout(timeOut);
                stop(emitter);
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
    },

    'start, check ecv and stop': function(test) {
        var emitter = new EventEmitter(), child = start(emitter);

        emitter.on('starting', function() {
            waitForStart(child, emitter, test, 0, 100);
        });

        emitter.on('started', function () {
            setTimeout(function(){
                request(util.format('http://localhost:%d/ecv', port), function (error, response, body) {
                    // Regex to match the expected response. Tricky part is the IPv4 match.
                    // Very naive exp to check numbers 0 - 255.
                    // (25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]? ) -> ( numbers 250 to 255 | numbers 200 to 249 | numbers 0 to 199)
                    // Same expression for each of the 4 IPs
                    var hostname = require('os').hostname();
                    var re = new RegExp(util.format(
                        'status=AVAILABLE&ServeTraffic=true&ip=(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)&hostname=%s&port=%d&time=.*',
                        hostname,
                        port));

                    test.ok(re.exec(body) !== null,
                            util.format('expected:status=AVAILABLE&ServeTraffic=true&ip=<Network IP>&hostname=%s&port=%d&time=.*&error=%s&body=%s', hostname, port, error, body));
                    
                    stop(emitter);
                })
            }, 1000);
        });

        emitter.on('start failure', function (error) {
            log('Failed to start ', error.stack || error);
            test.ok(false, 'failed to start')
        });

        emitter.on('stopping', function() {
            waitForStop.apply(null, [emitter, test, 0, 100]);
        });

        emitter.on('stopped', function() {
            log('Stopped');
            // Assert that there are 0 pids.
            fs.readdir('./pids', function(err, paths) {
                test.equal(paths.length, 0);
            });
            test.done();
        })

        emitter.emit('starting');
    },

    'start and then shutdown': function (test) {
        var emitter = new EventEmitter(), child = start(emitter);

        emitter.on('starting', function () {
            waitForStart(child, emitter, test, 0, 100);
        });

        emitter.on('started', function () {
            shutdown(emitter);
        });

        emitter.on('start failure', function (error) {
            log('Failed to start ', error.stack || error);
            test.ok(false, 'failed to start')
        });

        emitter.on('stopping', function () {
            waitForStop.apply(null, [emitter, test, 0, 100])
        });

        emitter.on('stopped', function () {
            log('Stopped');
            // Assert that there are 0 pids.
            fs.readdir('./pids', function (err, paths) {
                test.equal(paths.length, 0);
            });
            test.done();
        });

        emitter.emit('starting');
    },


    'start, send traffic, get responses, and then shutdown': function (test) {
        var emitter = new EventEmitter(), child = start(emitter);

        emitter.on('starting', function () {
            waitForStart(child, emitter, test, 0, 100);
        });

        emitter.on('started', function () {
            var respCount = 0;
            for(var i = 0; i < 10; i++) {
                request(util.format('http://localhost:%d', port), function (error, response, body) {
                    if(error) {
                        test.ok(false, 'got error from server')
                    }
                    else {
                        respCount++;
                        if(respCount === 10) {
                            return shutdown(emitter);
                        }
                    }
                });
            }
        });

        emitter.on('start failure', function (error) {
            log('Failed to start ', error.stack || error);
            test.ok(false, 'failed to start')
        });

        emitter.on('stopping', function () {
            waitForStop.apply(null, [emitter, test, 0, 100])
        });

        emitter.on('stopped', function () {
            log('Stopped');
            // Assert that there are 0 pids.
            fs.readdir('./pids', function (err, paths) {
                test.equal(paths.length, 0);
            });
            test.done();
        });

        emitter.emit('starting');
    },

    'start, graceful shutdown': function (test) {
        var emitter = new EventEmitter(), child = start(emitter);

        emitter.on('starting', function () {
            waitForStart(child, emitter, test, 0, 100);
        });

        var respCount = 0;
        emitter.on('started', function () {
            for(var i = 0; i < 2000; i++) {
                request(util.format('http://localhost:%d', port), function (error, response, body) {
                    if(error) {
                        test.ok(false, 'got error from server')
                    }
                    else {
                        respCount++;
                    }
                });
            }
            // Send shutdown while requests are in-flight
            shutdown(emitter);
        });

        emitter.on('start failure', function (error) {
            log('Failed to start ', error.stack || error);
            test.ok(false, 'failed to start')
        });

        emitter.on('stopping', function () {
            waitForStop.apply(null, [emitter, test, 0, 100])
        });

        emitter.on('stopped', function () {
            // Ensure that all in-flight requests are handled
            test.equals(respCount, 2000);
            log('Stopped');
            // Assert that there are 0 pids.
            fs.readdir('./pids', function (err, paths) {
                test.equal(paths.length, 0);
            });
            test.done();
        });

        emitter.emit('starting');
    },

    'start, check recycle on threshold, shutdown': function (test) {
        var emitter = new EventEmitter(), child = start(emitter);

        emitter.on('starting', function () {
            waitForStart(child, emitter, test, 0, 100);
        });

        var respCount = 0, errCount = 0;
        emitter.on('started', function () {
            var paths = fs.readdirSync('./pids');

            // connThreshold is 10. So, sending 20+ requests without pooling would cause
            // recycle
            for(var i = 0; i < 100; i++) {
                request({
                    uri: util.format('http://localhost:%d', port),
                    headers: {
                        'connection': 'close'
                    }
                }, function (error, response, body) {
                    if(error) {
                        test.ok(false, error.message || 'got error from server')
                    }
                    else {
                        respCount++;
                    }
                    if(respCount === 100) {
                        // Wait for process recycling to complete
                        setTimeout(function() {
                            // Before shutting down, check the pids again
                            var pathsEnd = fs.readdirSync('./pids');
                            test.ok(pathsEnd.length > paths.length, 'Expected more processes');
                            shutdown(emitter);
                        }, 5000);
                    }
                });
            }
        });

        emitter.on('start failure', function (error) {
            log('Failed to start ', error.stack || error);
            test.ok(false, 'failed to start')
        });

        emitter.on('stopping', function () {
            waitForStop.apply(null, [emitter, test, 0, 100])
        });

        emitter.on('stopped', function () {
            fs.readdir('./pids', function (err, paths) {
                test.equal(paths.length, 0);
            });
            test.ok(respCount + errCount, 2000);
            log('Stopped');
            // Assert that there are 0 pids.
            fs.readdir('./pids', function (err, paths) {
                test.equal(paths.length, 0);
            });
            test.done();
        });

        emitter.emit('starting');
    },

    'start, abrupt stop': function (test) {
        var emitter = new EventEmitter(), child = start(emitter);

        emitter.on('starting', function () {
            waitForStart(child, emitter, test, 0, 100);
        });

        var respCount = 0, errCount = 0;
        emitter.on('started', function () {
            for(var i = 0; i < 2000; i++) {
                request(util.format('http://localhost:%d', port), function (error, response, body) {
                    if(error) {
                        errCount++;
                    }
                    else {
                        respCount++;
                    }
                });
            }
            // Send shutdown while requests are in-flight
            stop(emitter);
        });

        emitter.on('start failure', function (error) {
            log('Failed to start ', error.stack || error);
            test.ok(false, 'failed to start')
        });

        emitter.on('stopping', function () {
            waitForStop.apply(null, [emitter, test, 0, 100])
        });

        emitter.on('stopped', function () {
            // Ensure that all in-flight requests are handled
            test.ok(respCount + errCount, 2000);
            log('Stopped');
            // Assert that there are 0 pids.
            fs.readdir('./pids', function (err, paths) {
                test.equal(paths.length, 0);
            });
            test.done();
        });

        emitter.emit('starting');
    },

    'start, disable, enable and stop': function(test) {
        var emitter = new EventEmitter(), child = start(emitter);

        emitter.on('starting', function () {
            waitForStart(child, emitter, test, 0, 100);
        });

        emitter.on('started', function () {
            request(util.format('http://localhost:%d/ecv', port), function (error, response, body) {
                // Regex to match the expected response. Tricky part is the IPv4 match.
                // Very naive exp to check numbers 0 - 255.
                // (25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]? ) -> ( numbers 250 to 255 | numbers 200 to 249 | numbers 0 to 199)
                // Same expression for each of the 4 IPs
                var hostname = require('os').hostname();
                var re = new RegExp(util.format(
                    'status=AVAILABLE&ServeTraffic=true&ip=(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)&hostname=%s&port=%d&time=.*',
                    hostname,
                    port));
                var result = re.exec(body);
                test.ok(result !== null,
                    util.format('expected:status=AVAILABLE&ServeTraffic=true&ip=<Network IP>&hostname=%s&port=%d&time=.*', hostname, port));

                request({uri: util.format('http://localhost:%d/ecv/disable', port), method: 'POST'}, function (error, response, body) {
                    // Wait for signal to propagate to workers
                    setTimeout(function() {
                        request(util.format('http://localhost:%d/ecv', port), function (error, response, body) {
                            re = new RegExp(util.format(
                                'status=DISABLED&ServeTraffic=false&ip=(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)&hostname=%s&port=%d&time=.*',
                                hostname,
                                port));
                            var result = re.exec(body);
                            test.ok(result !== null,
                                util.format('expected:status=AVAILABLE&ServeTraffic=false&ip=<Network IP>&hostname=%s&port=%d&time=.*', hostname, port));
                            request({uri: util.format('http://localhost:%d/ecv/enable', port), method: 'POST'}, function (error, response, body) {
                                if(error) {
                                    test.ok(false, 'could not enable again');
                                }
                                setTimeout(function() {
                                    request(util.format('http://localhost:%d/ecv', port), function (error, response, body) {
                                        if(error) {
                                            test.ok(false, 'ecv did not succeed');
                                        }
                                        stop(emitter);
                                    });
                                }, 200);
                            });
                        });

                    }, 200);
                });
            });
        });

        emitter.on('start failure', function (error) {
            log('Failed to start ', error.stack || error);
            test.ok(false, 'failed to start')
        });

        emitter.on('stopping', function () {
            waitForStop.apply(null, [emitter, test, 0, 100])
        });

        emitter.on('stopped', function () {
            log('Stopped');
            // Assert that there are 0 pids.
            fs.readdir('./pids', function (err, paths) {
                test.equal(paths.length, 0);
            });
            test.done();
        })

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
    var start = spawn('node', ['test/lib/server.js'], {
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


