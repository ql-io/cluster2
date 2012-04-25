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
                            process.nextTick(function() {
                                that.kill(that.options.pids + '/' + mf, signal);
                            })
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
        fs.readFile(fullname, 'ascii', function(err, data) {
            var pid = parseInt(data);
            if(pid === process.pid) {
                fs.unlinkSync(fullname);
                process.exit(0);
            }
            else {
                try {
                    process.kill(pid, signal);
                }
                catch(e) {
                }
            }
            fs.unlink(fullname, function(err) {
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
        self.killall(('SIGINT'))
    });
    this.emitter.on('SIGTERM', function() {
        self.killall('SIGTERM')
    });
    this.emitter.on('SIGKILL', function() {
        self.killall('SIGKILL')
    });

    this.createWorker = function () {
        var worker = cluster.fork();
        var self = this;
        fs.writeFileSync(this.options.pids + '/worker.' + worker.pid + '.pid', worker.pid);
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

        this.stats.noWorkers = this.stats.noWorkers++;
    }
}

Process.prototype.listen = function(app, cb) {
    var self = this;
    if(cluster.isMaster) {
        this.stats.pid = process.pid;
        this.stats.start = new Date();
        this.stats.totalmem = os.totalmem();
        this.stats.freemem = os.freemem();

        // If the port is already occupied, this will exit to prevent node workers from multiple
        // masters hanging around together
        var monitor = new Monitor({
            stats: self.stats,
            port: self.options.monPort || '8081',
            path: self.options.monPath || '/'}
        );
        // Monitor to server ecv checks
        monitor.on('error', function (e) {
            if(e.code === 'EADDRINUSE') {
                console.log('Address in use ...');
                process.exit(-1);
            }
        });

        monitor.on('listening', function() {
            misc.ensureDir(process.cwd() + '/pids', true); // Ensure pids dir
            misc.ensureDir(process.cwd() + '/logs'); // Ensure logs dir

            fs.writeFileSync(self.options.pids + '/master.' + self.stats.pid + '.pid', self.stats.pid);
            console.log('Master ' + process.pid + ' started');

            // Fork workers
            for(var i = 0; i < self.options.noWorkers; i++) {
                self.createWorker();
            }

            var deathWatcher = function (worker) {
                self.emitter.emit('died', worker.pid);
                self.stats.workersKilled++;
                self.stats.noWorkers--;
                self.createWorker();
                delete self.stats.workers[worker.pid];
            };
            cluster.on('death', deathWatcher);


            process.on('SIGINT', function() {
                cluster.removeListener('death', deathWatcher);
                self.emitter.emit('SIGINT');
            });

            process.on('SIGTERM', function() {
                self.emitter.emit('SIGTERM', {
                    pid: process.pid,
                    type: 'master'
                });

                process.exit(0);
            });

            app.addListener('connection', function(conn) {
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
        var listening = false;
        process.on('SIGINT', function() {
            self.emitter.emit('SIGINT', {
                pid: process.pid,
                type: 'worker'
            });
            process.exit();
        });
        process.on('SIGTERM', function() {
            // Don't accept connections
            if(listening) {
                app.close();
            }
            self.emitter.emit('SIGTERM', {
                pid: process.pid,
                type: 'worker'
            });
        });

        app.on('listening', function() {
            listening = true;
        });

        app.on('close', function() {
            var interval = setInterval(function() {
                if(conns <= 0) {
                    console.log('got close ' + conns);
                    clearInterval(interval);
                    process.exit(0);
                }
            }, 100)
        });

        // Workers are net.Servers.
        app.listen(this.options.port, function() {
            console.log('Worker ' + process.pid + ' listening on ' + self.options.port);
            if(self.options.ecv) {
                ecv.enable(app, self.options.port, self.options.ecvPath, self.options.ecv.monitor, function(data) {
                    return true;
                });
            }
            cb();
        });

        // Set time out on client sockets
        var conns = 0;
        function prestine(conn) {
            conns++;
            console.log(process.pid + ' ' + conns);
            conn.setTimeout(self.options.timeout || 10 * 1000,
                function () {
                    self.emitter.emit('warning', {
                        message: 'Client socket timed out'
                    });
                    conn.destroy();
                }
            ); // Timeout after 1min
            conn.on('close', function() {
                conns--;
                console.log(process.pid + ' ' + conns);
            })
        }
        app.addListener('connection', prestine);
    }
};

Process.prototype.stop = function() {
    this.emitter.emit('SIGKILL');
};

Process.prototype.shutdown = function() {
    this.emitter.emit('SIGTERM');
};

