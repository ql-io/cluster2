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
    os = require('os'),
    fs = require('fs');

// Master process
var Master = module.exports = function Master(options) {
    this.options = options || {};

    // Stats
    this.stats = {
        workers: {}
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

        this.stats.noWorkers++;
    }
}

Master.prototype.listen = function(app, cb) {
    var self = this;
    if(cluster.isMaster) {
        misc.ensureDir(process.cwd() + '/pids', true); // Ensure pids dir
        misc.ensureDir(process.cwd() + '/logs'); // Ensure logs dir

        this.stats.pid = process.pid;
        this.stats.start = new Date();
        this.stats.totalmem = os.totalmem();
        this.stats.freemem = os.freemem();
        fs.writeFileSync(this.options.pids + '/master.' + this.stats.pid + '.pid', this.stats.pid);

        console.log('Master ' + process.pid + ' started');

        // Fork workers.
        var noWorkers = os.cpus().length;
        for(var i = 0; i < noWorkers; i++) {
            this.createWorker();
        }

        var that = this;
        var deathWatcher = function (worker) {
            that.stats.workersKilled++;
            that.stats.noWorkers--;
            that.createWorker();
            delete that.stats.workers[worker.pid];
        };
        cluster.on('death', deathWatcher);

        var monitor = new Monitor({
            stats: that.stats,
            port: that.options.monPort || '8081',
            path: that.options.monPath || '/'}
        );

        process.on('SIGINT', function() {
            cluster.removeListener('death', deathWatcher);
            cluster.on('done', function() {

            })
            that.killall('SIGINT');
        });
        monitor.listen(cb);
    }
    else {
        // Worker processes have a http server.
        app.listen(this.options.port, function() {
            console.log('Worker ' + process.pid + ' listening on ' + self.options.port);
            if(self.options.ecv) {
                ecv.enable(app, self.options.port, self.options.ecvPath, self.options.ecv.monitor, function(data) {
                    return true;
                });
            }
            cb();
        });
    }
};

Master.prototype.stop = function() {
    this.killall('SIGKILL');
};

Master.prototype.shutdown = function() {
    this.killall('SIGTERM');
};

