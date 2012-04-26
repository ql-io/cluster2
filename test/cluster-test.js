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

'use strict'

var childProcess = require('child_process'),
    request = require('request'),
    fs = require('fs'),
    os = require('os'),
    EventEmitter = require('events').EventEmitter;

var debug = true;
function log() {
    if(debug) {
        console.log.apply(null, arguments);
    }
}
module.exports = {
    'start and then stop': function(test) {
        var emitter = new EventEmitter();

        emitter.on('starting', function() {
            waitForStart(emitter, test, 0, 100);
        });

        emitter.on('started', function () {
            stop(emitter);
        });

        emitter.on('start failure', function (error) {
            log('Failed to start');
            log(error.stack || error);
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
        start(emitter);
    },

    'start, check ecv and stop': function(test) {
        var emitter = new EventEmitter();

        emitter.on('starting', function() {
            waitForStart(emitter, test, 0, 100);
        });

        emitter.on('started', function () {
            request('http://localhost:3000/ecv', function (error, response, body) {
                // Regex to match the expected response. Tricky part is the IPv4 match.
                // Very naive exp to check numbers 0 - 255.
                // (25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]? ) -> ( numbers 250 to 255 | numbers 200 to 249 | numbers 0 to 199)
                // Same expression for each of the 4 IPs
                var hostname = require('os').hostname();
                var re = new RegExp('status=AVAILABLE&ServeTraffic=true&ip=(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.(25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)&hostname=' + hostname + '&port=3000&time=.*');
                var result = re.exec(body);
                test.ok(result !== null,
                        'expected:status=AVAILABLE&ServeTraffic=true&ip=<Network IP>&hostname=' + hostname + '&port=3000&time=.*');
                stop(emitter);
            });
        });

        emitter.on('start failure', function (error) {
            log('Failed to start');
            log(error.stack || error);
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
        })
        start(emitter);
    },

    'start and then shutdown': function(test) {
            var emitter = new EventEmitter();

            emitter.on('starting', function() {
                waitForStart(emitter, test, 0, 100);
            });

            emitter.on('started', function () {
                shutdown(emitter);
            });

            emitter.on('start failure', function (error) {
                log('Failed to start');
                log(error.stack || error);
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
            start(emitter);
        },
}

// Start the cluster
function start(emitter) {
    log('Starting');
    var start = childProcess.spawn('test/bin/start.sh');
    start.on('exit', function (code, signal) {
        log('Process exited with signal ' + signal + ' and code ' + code);
    });

    start.stdout.setEncoding('utf8');
    start.stdout.on('data', function (data) {
        log(data);
    });
    start.stderr.setEncoding('utf8');
    start.stderr.on('data', function (data) {
        log('error: ' + data);
    });
    emitter.emit('starting');
}

function stop(emitter) {
    log('Stopping');
    var stop = childProcess.spawn('test/bin/stop.sh');
    stop.on('exit', function (code, signal) {
        log('Process exited with signal ' + signal + ' and code ' + code);
    });

    stop.stdout.setEncoding('utf8');
    stop.stdout.on('data', function (data) {
        log(data);
    });
    emitter.emit('stopping');
}

function shutdown(emitter) {
    log('Shutting down');
    var stop = childProcess.spawn('test/bin/shutdown.sh');
    stop.on('exit', function (code, signal) {
        log('Process exited with signal ' + signal + ' and code ' + code);
    });

    stop.stdout.setEncoding('utf8');
    stop.stdout.on('data', function (data) {
        log(data);
    });
    emitter.emit('stopping');
}


function waitForStart(emitter, test, current, max) {
    current++;
    if(current < max) {
        request('http://localhost:3000', function (error, response, body) {
            log('Waiting for server to start');
            if(error) {
                log('Error: ');
                log(error.stack || error);
                if(error.code === 'ECONNREFUSED') {
                    setTimeout(function () {
                        waitForStart.apply(null, [emitter, test, current, max])
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


function waitForStop(emitter, test, current, max) {
    current++;
    if(current < max) {
        request('http://localhost:3000', function (error, response, body) {
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

function checkPids(test, len) {
    // Assert that there are n+1 pids.
    fs.readdir('./pids', function (err, paths) {
        test.equal(paths.length, len);
    });
}

