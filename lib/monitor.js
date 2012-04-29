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
    express = require('express'),
    ejs = require('ejs'),
    fs = require('fs'),
    util = require('util'),
    npm = require('npm'),
    os = require('os'),
    _ = require('underscore');

// Monitor
var Monitor = module.exports = function Monitor(options) {
    this.options = options || {port: 8081, stats: {}, path: '/'};
    this.stats = this.options.stats;

    var app = express.createServer();

    var self = this;
    app.set('views', __dirname + '/../public/views');
    app.use(express.static(__dirname + '/../public'));
    app.set('view engine', 'html');

    app.get(this.options.path, function (req, res) {
        var accept = (req.headers || {}).accept || '';
        if(accept.search('json') > 0) {
            res.contentType('application/json');
            res.send(JSON.stringify(getStats(self.stats, req.connection)));
        }
        else {
            res.render('index.ejs', getStats(self.stats, req.connection));
        }
    });

    app.get(/^\/logs?(?:\/(\d+)(?:\.\.(\d+))?)?/, function (req, res) {
        var root, paths, logs, stats;
        var file = process.cwd() + req.url;
        if(req.url === '/logs') {
            root = process.cwd() + '/logs';
            paths = fs.readdirSync(root);
            logs = [];
            paths.forEach(function (filename) {
                stats = fs.statSync(root + '/' + filename);
                logs.push({
                    filename: filename,
                    stats: stats
                })
            });
            var data = getStats(self.stats, req.connection);
            data.logs = logs;
            res.render('logs.ejs', data);
        }
        else {
            var stat = fs.statSync(file);
            res.writeHead(200, {
                'Content-Type': 'text/plain',
                'Content-Length': stat.size
            });
            var readStream = fs.createReadStream(file);
            util.pump(readStream, res, function (e) {
                if(e) {
                    console.log(e.stack || e);
                }
                res.end();
            });
        }
    });

    app.get('/deps', function(req, res) {
        npm.load({}, function() {
            npm.commands.ls({}, true, function(e, data) {
                res.writeHead(200, {
                    'Content-Type': 'application/json'
                });

                var seen = [];
                var out = JSON.stringify(data, function (k, o) {
                    if(typeof o === "object") {
                        if(-1 !== seen.indexOf(o)) return '[Circular]';
                        seen.push(o);
                    }
                    return o;
                }, 2);
                res.end(out);
            });
        });
    });

    return app;
}

function getStats(master, socket) {
    master.hostname = os.hostname();
    master.os = os.type() + ' ' + os.release();
    master.averageLoad = os.loadavg().map(
                    function (n) {
                        return n.toFixed(2);
                    }).join(' ');
    master.coresUsed = master.noWorkers + ' of ' + os.cpus().length;
    master.memoryUsageAtBoot = misc.forMemoryNum(master.freemem) + ' of ' +
                    misc.forMemoryNum(master.totalmem);
    master.totalMem = os.totalmem().toFixed(3);
    master.currentMemoryUsage = (os.totalmem() - os.freemem()) / 1024000;
    master.hostCpu = (_.reduce(os.cpus(), function (memo, cpu) {
                    return memo + (cpu.times.user /
                        (cpu.times.user + cpu.times.nice +
                            cpu.times.sys + cpu.times.idle + cpu.times.irq));
                }, 0) * 100 / os.cpus().length).toFixed(2);

    if(socket) {
        master.address = socket.address();
    }

    return {master: master};
}
