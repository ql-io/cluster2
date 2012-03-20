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

var Master = require('./master.js'),
    os = require('os'),
    ecv = require('./ecv.js');

// Trap all uncaught exception here.
process.on('uncaughtException', function (error) {
    // TODO: This has to the log file
    console.log(error.stack || error);
});

exports.version = require('../package.json').version;

exports.listen = function (options, createApp, cb) {
    options = options || {};
    options.port = options.port || 8080;
    options.monPort = options.monPort || 8081;
    options.ecvPath = options.ecvPath || '/ecv';
    options.noWorkers = options.noWorkers || os.cpus().length;

    if(options.cluster) {
        var master = new Master({
            pids: process.cwd() + '/pids',
            logs: process.cwd() + '/logs',
            port: options.port,
            monPort: options.monPort,
            ecv: options.ecv,
            noWorkers: options.noWorkers
        });

        if(options.stop) {
            master.stop()
        }
        else if(options.shutdown) {
            master.shutdown();
        }
        else {
            createApp(function (app) {
                master.listen(app, function () {
                    if(cb) {
                        cb(app);
                    }
                });
            });
        }
    }
    else {
        createApp(function (app) {
            app.listen(options.port, function () {
                if(options.ecv) {
                    ecv.enable(app, options.port, options.ecvPath, options.ecv.monitor, function (data) {
                        return true;
                    });
                }
                if(cb) {
                    cb(app);
                }
            });
        });
    }
}

exports.stop = function () {
    var master = new Master({
        pids: process.cwd() + '/pids'
    });
    master.stop();
}

exports.shutdown = function () {
    var master = new Master({
        pids: process.cwd() + '/pids'
    });
    master.shutdown();
}
