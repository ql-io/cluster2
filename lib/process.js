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

var misc = require('./misc.js'),
    ecv = require('./ecv.js'),
    Monitor = require('./monitor.js'),
    _ = require('underscore'),
    assert = require('assert'),
    cluster = require('cluster'),
    EventEmitter = require('events').EventEmitter,
    os = require('os'),
    fs = require('fs');

var debug = process.env['cluster2'];
function log() {
    if(debug) {
        console.log.apply(null, arguments);
    }
}

// Master process
var Process = module.exports = function Process(options) {
    this.options = options || {};
    this.emitter = this.options.emitter || new EventEmitter();
    var self = this;

    // Stats
    this.stats = {
        workers: {},
        noWorkers: 0,
        workersKilled: 0
    };

    this.killall = function(signal) {
        log('killall called with signal ' + signal);
        var that = this, fullname;
        fs.readdir(that.options.pids, function(err, paths) {
            var count = paths.length;
            if(count === 0) {
                return;
            }
            var mf = _.find(paths, function(path) {
                return /master\./.test(path);
            });
            paths.forEach(function(filename) {
                fullname = that.options.pids + '/' + filename;
                if(/worker\./.test(filename)) {
                    that.kill(fullname, signal, function() {
                        count = count - 1;
                        if(count === 1 && mf) {
                            log('Sending ' + signal + ' to the master');
                            that.kill(that.options.pids + '/' + mf, signal);
                        }
                    });
                }
                else if(/worker\./.test(filename)) {
                    mf = fullname;
                }
            });
        })
    };

    this.kill = function(fullname, signal, f) {
        log('sending ' + signal + ' to ' + fullname);
        fs.readFile(fullname, 'ascii', function(err, data) {
            var pid = parseInt(data);
            if(pid === process.pid) {
                log('Unlinking ' + fullname);
                fs.unlinkSync(fullname);
                process.exit(0);
            }
            else {
                try {
                    process.kill(pid, signal);
                }
                catch(e) {
                    log(e.stack || e);
                }
            }
            fs.unlink(fullname, function(err) {
                log('Unlinking ' + fullname);
                if(err) {
                    console.log('Unable to delete ' + fullname);
                }
                if(f) {
                    assert.ok('function' === typeof f);
                    f();
                }
            });
        });
    };

    this.emitter.on('SIGINT', function() {
        if(cluster.isMaster) {
            self.killall(('SIGINT'))
        }
    });
    this.emitter.on('SIGTERM', function() {
        if(cluster.isMaster) {
            self.killall('SIGTERM');
        }
    });
    this.emitter.on('SIGKILL', function() {
        if(cluster.isMaster) {
            self.killall('SIGKILL');
        }
    });

    this.createWorker = function () {
        var worker = cluster.fork();
        var self = this;
        fs.writeFileSync(this.options.pids + '/worker.' + worker.pid + '.pid', worker.pid);

        self.emitter.emit('forked', worker.pid);

        // Collect counters from workers
        worker.on('message', function (message) {
                if(message.type === 'counter') {
                    var name = message.name;
                    if(!self.stats.workers[message.pid]) {
                        self.stats.workers[message.pid] = {};
                    }
                    var pidStats = self.stats.workers[message.pid];
                    if(!pidStats[name]) {
                        pidStats[name] = 0
                    }
                    pidStats[name]++;
                }
            }
        );

        this.stats.noWorkers++;

        worker.on('message', function(message) {
            if(message && message.command) {
                self.notifyWorkers(message);
            }
        });

        return worker;
    }

    this.notifyWorkers = function(message) {
        _.each(self.workers, function(worker) {
            worker.send(message)
        });
    }
}

Process.prototype.listen = function(app, cb) {
    var self = this;
    if(cluster.isMaster) {
        this.stats.pid = process.pid;
        this.stats.start = new Date();
        this.stats.totalmem = os.totalmem();
        this.stats.freemem = os.freemem();
        this.workers = [];

        // Monitor to serve log files and other stats - typically on an internal port
        var monitor = new Monitor({
            stats: self.stats,
            port: self.options.monPort,
            path: self.options.monPath}
        );
        monitor.on('listening', function() {
            misc.ensureDir(process.cwd() + '/pids', true); // Ensure pids dir
            misc.ensureDir(process.cwd() + '/logs'); // Ensure logs dir

            fs.writeFileSync(self.options.pids + '/master.' + self.stats.pid + '.pid', self.stats.pid);
            console.log('Master ' + process.pid + ' started');

            // Fork workers
            for(var i = 0; i < self.options.noWorkers; i++) {
                var worker = self.createWorker();
                self.workers[worker.pid + ''] = worker;
            }

            var deathWatcher = function (worker) {
                self.emitter.emit('died', worker.pid);
                self.stats.workersKilled++;
                self.stats.noWorkers--;
                var worker = self.createWorker();
                self.workers[worker.pid + ''] = worker;
                delete self.workers[worker.pid + ''];
                delete self.stats.workers[worker.pid];
            };
            cluster.on('death', deathWatcher);

            process.on('SIGINT', function() {
                cluster.removeListener('death', deathWatcher);
                self.emitter.emit('SIGINT');
            });

            process.on('SIGTERM', function() {
                log(process.pid + ' got SIGTERM');
                self.emitter.emit('SIGTERM', {
                    pid: process.pid,
                    type: 'master'
                });

                process.exit(0);
            });

            app.on('connection', function(conn) {
                console.log('master conn listener');
            });
            cb.call(null);
        });

        monitor.on('error', function (e) {
            if(e.code === 'EADDRINUSE') {
                console.log('Address in use ...');
                process.exit(-1);
            }
        });
        monitor.listen(this.options.monPort);
    }
    else {
        var listening = false, conns = 0, totalConns = 0, timedoutConns = 0;
        process.on('SIGINT', function() {
            self.emitter.emit('SIGINT', {
                pid: process.pid,
                type: 'worker'
            });
            process.exit();
        });
        process.on('SIGTERM', function() {
            log(process.pid + ' got SIGTERM');
            // Don't accept connections
            if(listening) {
                try {
                    app.close();
                }
                catch(e) {}
            }
            self.emitter.emit('SIGTERM', {
                pid: process.pid,
                type: 'worker'
            });
            // Once all pending connections are closed, exit.
            var internal = setInterval(function() {
                if(conns === 0) {
                    clearInterval(internal);
                    process.exit(0);
                }
            }, 100);
        });

        app.on('listening', function() {
            listening = true;
        });

        // Workers are net.Servers
        var ports = _.isArray(this.options.port) ? this.options.port : [this.options.port];
          _.each(ports, function(port) {
              app.listen(port, function() {
                  console.log('Worker ' + process.pid + ' listening on ' + port);
                  if(self.options.ecv) {
                      ecv.enable(app, self.options, self.emitter, function(data) {
                          return true;
                      });
                  }
                  cb();
              });
          })

        // Set time out on idle sockets
        function setTimeout(conn) {
            conns++;
            totalConns++;
            conn.setTimeout(self.options.timeout,
                function () {
                    timedoutConns++;
                    self.emitter.emit('warning', {
                        message: 'Client socket timed out'
                    });
                    conn.destroy();
                }
            );
            conn.on('close', function() {
                conns--;
            })
        }
        app.on('connection', setTimeout);

        // Recycle self when no of connections connection threshold
        var threshold = self.options.connThreshold;
        var recycle = setInterval(function() {
            if(totalConns > threshold) {
                clearInterval(recycle);
                process.emit('SIGTERM');
            }
        },  100);

        // Heartbeat - make sure to clear this on 'close'
        // TODO: Other details to include
        var heartbeat = setInterval(function () {
            self.emitter.emit('heartbeat', {
                pid: process.pid,
                uptime: Math.round(process.uptime()),
                freemem: os.freemem(),
                totalConnections: totalConns,
                pendingConnections: conns,
                timedoutConnections: timedoutConns
            });
        }, 60000);

        app.on('close', function() {
            clearInterval(heartbeat);
            clearInterval(recycle);
        })
    }

    process.on('exit', function () {
        log(process.pid + ' is about to exit.');
    });
};

Process.prototype.stop = function() {
    this.emitter.emit('SIGKILL');
};

Process.prototype.shutdown = function() {
    log('Shutdown request received - emitting SIGTERM');
    this.emitter.emit('SIGTERM');
};

