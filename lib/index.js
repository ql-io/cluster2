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

var Cluster = module.exports = function Cluster(options) {
    // Extend from EventEmitter
    events.EventEmitter.call(this);

    this.options = options || {};
    this.options.port = this.options.port || 3000;
    this.options.monPort = this.options.monPort || 3001;
    this.options.ecv = this.options.ecv || {
        path: '/ecv'
    }
    this.options.monPath = this.options.monPath || '/';
    this.options.noWorkers = this.options.noWorkers || os.cpus().length;
}

util.inherits(Cluster, events.EventEmitter);

/**
 * Start the cluster
 */
Cluster.prototype.listen = function(createApp, cb) {
    var self = this;
    assert.ok(_.isFunction(createApp), 'createApp must be a function');

    if(!self.options.hasOwnProperty('cluster') || self.options.cluster === true) {
        var master = new Process({
            pids: process.cwd() + '/pids',
            logs: process.cwd() + '/logs',
            port: self.options.port,
            monPort: self.options.monPort,
            monPath: self.options.monPath,
            ecv: self.options.ecv,
            noWorkers: self.options.noWorkers,
            timeout: self.options.timeout || 30 * 1000, // idle socket timeout
            connThreshold: self.options.connThreshold || 10000, // recycle workers after this many connections
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
        createApp.call(null, function (app) {
            app.listen(ports[0], function () { 
                if (self.options.ecv) { 
                    ecv.enable(app, self.options, self, function (data) { 
                        return true; 
                    }); 
                } 
                if (cb) { 
                    cb(app); 
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

            exitIfBusyPort(ports, ports.length - 1, function(){
                cb(_.filter(_.isArray(app) ? app : [{app: app, port: self.options.port}],
                    function(app){
                        return app.app && app.port;
                    }), monApp);
            });
        });
    }

    function exitIfBusyPort(port, index, cb) {
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
        server.listen(port[index], function() { //'listening' listener
            exitIfBusyPort(port, index-1, function(){
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
