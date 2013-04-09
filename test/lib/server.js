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

var Cluster = require('../../lib/index.js'),
    express = require('express');

var server = express.createServer();
var serving = true;
server.get('/', function(req, res) {
    res.send('hello');
    if(!serving)  {
        req.connection.end();
    }
});

server.on('close', function() {
    serving = false;
})

var c = new Cluster({
    timeout: 300 * 1000,
    port: process.env["port"] || 3000,
    monPort: process.env["monPort"] || 10000 - process.env["port"] || 3001,
    cluster: true,
    noWorkers: process.env["noWorkers"] || 2,
    connThreshold: 10,
    ecv: {
        control: true
    }
});

c.on('died', function(pid) {
    console.log('Worker ' + pid + ' died');
});
c.on('forked', function(pid) {
    console.log('Worker ' + pid + ' forked');
});
c.on('SIGKILL', function() {
    console.log('Got SIGKILL');
    process.send({
        'signal':'SIGKILL'
    });
});
c.on('SIGTERM', function(event) {
    console.log('Got SIGTERM - shutting down');
    console.log(event);
    process.send({
        'signal':'SIGTERM'
    });
});
c.on('SIGINT', function() {
    console.log('Got SIGINT');
    process.send({
        'signal':'SIGINT'
    });
});

c.listen(function(cb) {
    cb(server);
    process.send({
        ready: true
    });
});
