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

var Process = require('./process.js'),
    ecv = require('./ecv.js'),
    _ = require('underscore'),
    assert = require('assert'),
    os = require('os'),
    util = require('util'),
    net = require('net'),
    events = require('events');

// Trap all uncaught exception here.
process.on('uncaughtException', function (error) {
    // TODO: This has to the log file
    console.error(error.stack || error);
});

exports.version = require('../package.json').version;
exports.defaultOptions = {
    cluster: true,
    port: 3000,
    monPort: 3001,
    pids: process.cwd() + '/pids',
    logs: process.cwd() + '/logs',
    ecv: {
        path: '/ecv'
    },
    monPath: '/',
    noWorkers: os.cpus().length
};

var Cluster = module.exports = function Cluster(options) {
    // Extend from EventEmitter
    events.EventEmitter.call(this);

    this.options = {};
    _.extend(this.options, exports.defaultOptions);
    _.extend(this.options, options);

    assert.notEqual(this.options.port, this.options.monPort, "monitor port & application port cannot use the same!");
}

util.inherits(Cluster, events.EventEmitter);

/**
 * Start the cluster
 */
Cluster.prototype.listen = function(createApp, cb) {
    var self = this;
    assert.ok(_.isFunction(createApp), 'createApp must be a function');

    if(self.options.cluster) {
        var master = new Process({
            pids: self.options.pids,
            logs: self.options.logs,
            port: self.options.port,
            host: self.options.host || '0.0.0.0',
            monPort: self.options.monPort,
            monHost: self.options.monHost || '0.0.0.0',
            monPath: self.options.monPath,
            ecv: self.options.ecv,
            noWorkers: self.options.noWorkers,
            timeout: self.options.timeout || 30 * 1000, // idle socket timeout
            connThreshold: self.options.connThreshold || 10000, // recycle workers after this many connections
            heartbeatInterval: self.options.heartbeatInterval,
            emitter: self
        });

        if(self.options.stop) {
            master.stop()
        }
        else if(self.options.shutdown) {
            master.shutdown();
        }
        else {
            initApp(function (app, monApp) {
                master.listen(app, monApp, function () {
                    if(self.options.ecv) {
                        ecv.enable(app, self.options, self, function (data) {
                            return true;
                        });
                    }
                    if(cb) {
                        cb(app, monApp);
                    }
                });
            });
        }
    }
    else { 
        // Temp Fix to unblock tech talk demo 
        var ports = _.isArray(self.options.port) ? self.options.port : [self.options.port]; 
        if (ports.length > 1) { 
            console.log('Provide a single port for non-cluster mode. Exiting.'); 
            process.exit(-1); 
        } 
        var host = self.options.host;
        createApp.call(null, function (app) {
            app.listen(ports[0], host, function () { 
                var apps = [
                    {
                        app: app,
                    },
                ];
                if (self.options.ecv) { 
                    ecv.enable(apps, self.options, self, function (data) {
                        return true; 
                    }); 
                } 
                if (cb) { 
                    cb(apps);
                } 
            }); 
        }); 
    }

    function initApp(cb) {
        createApp.call(null, function (app, monApp) {
            // If the port is already occupied, this will exit to prevent node workers from multiple
            // masters hanging around together
            var ports = _.isArray(app) ? _.reduce(app, function(arr, anApp){
                return arr.concat(anApp.port && anApp.app ?
                    _.isArray(anApp.port) ? anApp.port : [anApp.port] : []);
            },[])
                :_.isArray(self.options.port) ? self.options.port : [self.options.port];
            var host = self.options.host;

            exitIfBusyPort(host, ports, ports.length - 1, function(){
                cb(_.filter(_.isArray(app) ? app : [{app: app, port: self.options.port}],
                    function(app){
                        return app.app && app.port;
                    }), monApp);
            });
        });
    }

    function exitIfBusyPort(host, port, index, cb) {
        if(index < 0) {
            return cb();
        }
        var server = net.createServer();
        server.on('error', function (e) {
            if(e.code === 'EADDRINUSE') {
                console.error('Port is use ..' + port[index]);
                process.exit(-1);
            }
        });
        server.listen(port[index], host, function() { //'listening' listener
            exitIfBusyPort(host, port, index-1, function(){
                server.close();
                cb();
            })
        });
    }
}


Cluster.prototype.stop = function () {
    var master = new Process({
        pids: process.cwd() + '/pids'
    });
    master.stop();
}

Cluster.prototype.shutdown = function () {
    var master = new Process({
        pids: process.cwd() + '/pids'
    });
    master.shutdown();
}
