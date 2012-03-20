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

var Master = require('./master.js');

// Trap all uncaught exception here.
process.on('uncaughtException', function (error) {
    // TODO: This has to the log file
    console.log(error.stack || error);
});

exports.version = require('../package.json').version;

exports.listen = function (opts, createApp, cb) {
    opts = opts || {};
    opts.port = opts.port || 8080;
    opts.monPort = opts.monPort || 8081;
    opts.ecvPath = opts.ecvPath || '/ecv';

    if(opts.cluster) {
        var master = new Master({
            pids: process.cwd() + '/pids',
            logs: process.cwd() + '/logs',
            port: opts.port,
            monPort: opts.monPort,
            ecv: opts.ecv
        });

        if(opts.stop) {
            master.stop()
        }
        else if(opts.shutdown) {
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
            app.listen(opts.port, function () {
                console.log('Listening on ' + opts.port);
                if(cb) {
                    cb(app);
                }
            });
        });
    }
}
