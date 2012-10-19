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

"use strict";

var http = require('http'),
    _ = require('underscore'),
    os = require('os');

/**
 * The ECV check sends a "/tables" request to the running server. Anything other than a valid JSON response is
 * treated as an error.
 */
var hostname = os.hostname();

exports.enable = function(apps, options, emitter, validator) {
    var path = options.ecv.path || '/ecv';
    var monitor = options.ecv.monitor || undefined;
    var control = options.ecv.control || false;
    var root = path || '/ecv';
    var disabled;

    _.each(apps, function (app) {
        if (!_.isFunction(app.app.get)) { // this looks to be tcp server ... ecv is app's responsibility!
            return;
        }
        app.app.get(root, function (req, res) {
            var tosend = {
                date:new Date,
                port:_.isArray(options.port) ? options.port[0] : options.port
            };
            if (app.disabled) {
                // Drop the ball
                away(req, res, tosend);
                return;
            }
            var coptions = {
                host:'localhost',
                port:_.isArray(options.port) ? options.port[0] : options.port,
                path:monitor || '/',
                method:'GET',
                headers:{
                    host:'localhost',
                    connection:'close',
                    accept:'application/json'
                }
            };
            var creq = http.request(coptions, function (cres) {
                cres.setEncoding('utf8');
                var data = '';
                cres.on('data', function (chunk) {
                    data = data + chunk;
                });

                cres.on('end', function () {
                    if (cres.statusCode >= 300) {
                        // Not happy
                        unhappy(req, res, tosend);
                    }
                    else {
                        try {
                            if (validator) {
                                validator.apply(this, [res.status, res.headers, data]);
                            }
                            happy(req, res, tosend);
                        }
                        catch (e) {
                            // Not happy
                            unhappy(req, res, tosend);
                        }
                    }
                });
            });
            creq.on('error', function (err) {
                unhappy(req, res, tosend.date);
            });
            creq.end();
        });

        if (control === true) {
            app.app.post(root + '/disable', function (req, res) {
                app.disabled = true;
                emitter.emit('warning', {
                    message:'Disable request received'
                });
                if (process.send) {
                    process.send({
                        command:'disable'
                    });
                }
                res.writeHead(204, {
                    'since':new Date(Date.now() - process.uptime() * 1000),
                    'cache-control':'no-cache',
                    'X-Powered-By':'Cluster2',
                    'Connection':'close'
                });
                res.end()
            });

            app.app.post(root + '/enable', function (req, res) {
                app.disabled = false;
                emitter.emit('warning', {
                    message:'Enable request received'
                });
                if (process.send) {
                    process.send({
                        command:'enable'
                    });
                }
                res.writeHead(204);
                res.end()
            });

            process.on('message', function (message) {
                if (message && message.command) {
                    app.disabled = message.command === 'disable';
                }
            });
        }
    });
};

function happy(req, res, tosend) {
    res.writeHead(200, {
        'content-type': 'text/plain',
        'since': new Date(Date.now() - process.uptime()*1000),
        'cache-control': 'no-cache',
        'X-Powered-By': 'Cluster2',
        'Connection': 'close'
    });
    res.write('status=AVAILABLE&ServeTraffic=true&ip='+ req.connection.address()['address'] +'&hostname='+ hostname +'&port=' + tosend.port+ '&time=' + tosend.date.toString());
    res.end();
}

function unhappy(req, res, tosend) {
    res.writeHead(500, {
        'content-type': 'text/plain',
        'since': new Date(Date.now() - process.uptime()*1000),
        'cache-control': 'no-cache',
        'X-Powered-By': 'Cluster2',
        'Connection': 'close'
    });
    res.write('status=WARNING&ServeTraffic=false&ip='+ req.connection.address()['address'] +'&hostname='+ hostname +'&port=' + tosend.port + '&time=' + tosend.date.toString());
    res.end();
}

function away(req, res, tosend) {
    res.writeHead(400, {
        'content-type': 'text/plain',
        'since': new Date(Date.now() - process.uptime()*1000),
        'cache-control': 'no-cache',
        'X-Powered-By': 'Cluster2',
        'Connection': 'close'
    });
    res.write('status=DISABLED&ServeTraffic=false&ip='+ req.connection.address()['address'] +'&hostname='+ hostname +'&port=' + tosend.port + '&time=' + tosend.date.toString());
    res.end();
}
